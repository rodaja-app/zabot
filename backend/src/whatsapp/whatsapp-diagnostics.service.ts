import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import makeWASocket, {
  AuthenticationCreds,
  AuthenticationState,
  Browsers,
  ConnectionState,
  DisconnectReason,
  SignalDataTypeMap,
  fetchLatestBaileysVersion,
  initAuthCreds,
} from '@whiskeysockets/baileys';
import { silentBaileysLogger } from './baileys-whatsapp.provider';
import { ProxyConfigService } from './proxy-config.service';

const LIVE_TEST_TIMEOUT_MS = 25_000;

export interface WhatsAppLiveTestResult {
  ok: boolean;
  qrReceived: boolean;
  proxyEnabled: boolean;
  baileysVersion?: string;
  isLatestVersion?: boolean;
  closedReason?: string;
  statusCode?: number;
  rawMessage?: string;
  rawCode?: string;
  elapsedMs: number;
  error?: string;
}

/**
 * Diagnóstico de conexão WhatsApp ponta-a-ponta, exposto via
 * `GET /health/whatsapp-connect` — mesmo espírito de `/health/smtp` e
 * `/health/whatsapp`, mas aqui o teste é o handshake REAL (proxy DataImpulse
 * + protocolo Noise do WhatsApp), não só uma checagem de superfície. Motivo:
 * `/health/whatsapp` (proxy + versão Baileys) veio 100% saudável mesmo com a
 * conexão de verdade caindo com timeout — a causa está especificamente no
 * handshake, então só um handshake de verdade revela ela.
 *
 * Usa credenciais efêmeras, só em memória, geradas na hora e descartadas ao
 * final (`createEphemeralAuthState`) — nunca um arquivo em disco, nunca o
 * Postgres, nunca uma sessão de usuário real. Como as credenciais nunca
 * foram registradas no WhatsApp, o servidor sempre responde com um QR code
 * novo se o handshake completar — receber esse QR já é a prova de que proxy
 * + Noise handshake funcionam de ponta a ponta; não é preciso escanear nada.
 * Se a conexão cair antes disso, extrai a mesma causa crua do Boom que
 * `BaileysWhatsAppProvider.handleConnectionUpdate` loga para conexões reais.
 */
@Injectable()
export class WhatsAppDiagnosticsService {
  constructor(
    private readonly proxyConfig: ProxyConfigService,
    private readonly logger: Logger,
  ) {}

  async testLiveConnection(): Promise<WhatsAppLiveTestResult> {
    const startedAt = Date.now();
    const proxyEnabled = this.proxyConfig.isEnabled;
    const elapsed = () => Date.now() - startedAt;

    let version: Awaited<ReturnType<typeof fetchLatestBaileysVersion>>['version'];
    let isLatestVersion: boolean | undefined;
    try {
      const fetched = await fetchLatestBaileysVersion();
      version = fetched.version;
      isLatestVersion = fetched.isLatest;
    } catch (err) {
      return {
        ok: false,
        qrReceived: false,
        proxyEnabled,
        elapsedMs: elapsed(),
        error: `falha_ao_buscar_versao_baileys: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const baileysVersion = version.join('.');

    let agents: ReturnType<ProxyConfigService['buildTestAgents']>;
    try {
      agents = this.proxyConfig.buildTestAgents();
    } catch (err) {
      return {
        ok: false,
        qrReceived: false,
        proxyEnabled,
        baileysVersion,
        isLatestVersion,
        elapsedMs: elapsed(),
        error: `falha_ao_montar_agents_proxy: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    try {
      return await new Promise<WhatsAppLiveTestResult>((resolve) => {
        let settled = false;
        const { state, saveCreds } = createEphemeralAuthState();

        const socket = makeWASocket({
          version,
          auth: state,
          browser: Browsers.ubuntu('ZaBot-Diag'),
          printQRInTerminal: false,
          syncFullHistory: false,
          logger: silentBaileysLogger(),
          ...(agents ? { agent: agents.agent, fetchAgent: agents.fetchAgent } : {}),
        });

        const finish = (result: WhatsAppLiveTestResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutTimer);
          socket.ev.removeAllListeners('connection.update');
          socket.ev.removeAllListeners('creds.update');
          try {
            socket.end(undefined);
          } catch {
            // best-effort — socket já pode estar morto neste ponto, descarte é o objetivo
          }
          resolve(result);
        };

        const timeoutTimer = setTimeout(() => {
          finish({
            ok: false,
            qrReceived: false,
            proxyEnabled,
            baileysVersion,
            isLatestVersion,
            closedReason: 'timeout_sem_resposta',
            elapsedMs: elapsed(),
          });
        }, LIVE_TEST_TIMEOUT_MS);

        socket.ev.on('creds.update', saveCreds);
        socket.ev.on('connection.update', (update: Partial<ConnectionState>) => {
          if (settled) return;

          if (update.qr) {
            finish({
              ok: true,
              qrReceived: true,
              proxyEnabled,
              baileysVersion,
              isLatestVersion,
              elapsedMs: elapsed(),
            });
            return;
          }

          if (update.connection === 'close') {
            const boom = update.lastDisconnect?.error as
              | {
                  output?: { statusCode?: number; payload?: { message?: string; error?: string } };
                  message?: string;
                  code?: string;
                }
              | undefined;
            const statusCode = boom?.output?.statusCode;
            const rawMessage = boom?.output?.payload?.message ?? boom?.message;
            const rawCode = boom?.code;

            finish({
              ok: false,
              qrReceived: false,
              proxyEnabled,
              baileysVersion,
              isLatestVersion,
              closedReason: statusCode ? describeStatusCode(statusCode) : 'conexao_fechada_sem_qr',
              statusCode,
              rawMessage,
              rawCode,
              elapsedMs: elapsed(),
            });
          }
        });
      });
    } catch (err) {
      this.logger.error(
        { event: 'whatsapp_live_test_error', err },
        'Falha inesperada ao rodar teste de conexão ao vivo do WhatsApp',
      );
      return {
        ok: false,
        qrReceived: false,
        proxyEnabled,
        baileysVersion,
        isLatestVersion,
        elapsedMs: elapsed(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * Auth state 100% em memória, sem disco e sem Postgres — versão descartável
 * do contrato `{ state, saveCreds }` que `useDbAuthState`/`useMultiFileAuthState`
 * implementam, só para este teste de diagnóstico. `saveCreds` é no-op de
 * propósito: nada aqui deve sobreviver ao fim da chamada.
 */
function createEphemeralAuthState(): { state: AuthenticationState; saveCreds: () => Promise<void> } {
  const creds: AuthenticationCreds = initAuthCreds();
  const keyStore: Record<string, Record<string, unknown>> = {};

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const result: { [id: string]: SignalDataTypeMap[typeof type] } = {};
          const category = keyStore[type] ?? {};
          for (const id of ids) {
            if (category[id] !== undefined) {
              result[id] = category[id] as SignalDataTypeMap[typeof type];
            }
          }
          return result;
        },
        set: async (data) => {
          for (const keyType of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
            const categoryData = data[keyType];
            if (!categoryData) continue;
            keyStore[keyType] = keyStore[keyType] ?? {};
            for (const keyId of Object.keys(categoryData)) {
              const value = categoryData[keyId];
              if (value) {
                keyStore[keyType][keyId] = value;
              } else {
                delete keyStore[keyType][keyId];
              }
            }
          }
        },
      },
    },
    saveCreds: async () => {
      // efêmero — nunca persistido, credenciais descartadas ao fim do teste
    },
  };
}

/** Mesma categorização de `BaileysWhatsAppProvider.describeDisconnect` — rótulo consistente entre conexão real e diagnóstico. */
function describeStatusCode(statusCode: number): string {
  switch (statusCode) {
    case DisconnectReason.loggedOut:
      return 'logout_definitivo';
    case DisconnectReason.connectionReplaced:
      return 'sessao_substituida_por_outro_dispositivo';
    case DisconnectReason.badSession:
      return 'sessao_invalida';
    case DisconnectReason.restartRequired:
      return 'restart_exigido_pelo_whatsapp';
    case DisconnectReason.timedOut:
      return 'timeout_ou_conexao_perdida';
    case DisconnectReason.connectionClosed:
      return 'conexao_fechada_pelo_servidor';
    case DisconnectReason.multideviceMismatch:
      return 'incompatibilidade_multi_dispositivo';
    case DisconnectReason.forbidden:
      return 'bloqueado_pelo_whatsapp';
    case DisconnectReason.unavailableService:
      return 'servico_indisponivel';
    default:
      return `codigo_${statusCode}`;
  }
}
