import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import makeWASocket, {
  Browsers,
  ConnectionState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  WASocket,
} from '@whiskeysockets/baileys';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { SessionCryptoService } from '../common/security/session-crypto.service';
import { SessionNotConnectedError } from '../common/errors/app-error';
import { clearAuthState, useDbAuthState } from './db-auth-state';
import { ProxyAgents, ProxyConfigService } from './proxy-config.service';
import {
  NumberCheckResult,
  OutgoingMedia,
  SendMessageParams,
  StartSessionParams,
  WhatsAppProvider,
} from './whatsapp-provider.interface';

interface ActiveSocket {
  socket: WASocket;
  userId: string;
  phoneNumber?: string;
}

const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

/** Folga antes do limite da sessão sticky do DataImpulse — renova com essa antecedência, nunca em cima da hora (README raiz §4). */
const STICKY_RENEWAL_BUFFER_MINUTES = 2;
/** Piso de segurança: mesmo com `DATAIMPULSE_STICKY_MINUTES` configurado muito baixo, nunca agenda renovação em menos de 30s. */
const MIN_STICKY_RENEWAL_DELAY_MS = 30_000;

/**
 * Logger mínimo satisfazendo o formato que o Baileys espera (`.child()` +
 * trace/debug/info/warn/error/fatal). Deliberadamente silencioso: o
 * protocolo interno do Baileys é ruído demais para o log central; os
 * eventos que de fato importam para operação (conectou, caiu, por quê) já
 * são logados explicitamente em `handleConnectionUpdate()` via o Pino
 * central da aplicação — não perdemos "causa real do erro" nenhuma, só o
 * tráfego interno do protocolo.
 */
type BaileysLogger = Parameters<typeof makeWASocket>[0]['logger'];

function silentBaileysLogger(): BaileysLogger {
  const noop = () => undefined;
  const base: Record<string, unknown> = {
    level: 'silent',
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
  };
  base.child = () => base;
  return base as unknown as BaileysLogger;
}

/**
 * Implementação real de `WhatsAppProvider` sobre `@whiskeysockets/baileys`
 * (README §1/12). Um processo de worker de sessão mantém um `WASocket` por
 * sessão ativa em memória (`this.sockets`); a "fonte de verdade" persistida
 * é sempre o Postgres (auth state via `useDbAuthState`, status/telefone via
 * `SessionService`, que assina `connectionUpdates$`).
 */
@Injectable()
export class BaileysWhatsAppProvider extends WhatsAppProvider implements OnModuleDestroy {
  private readonly sockets = new Map<string, ActiveSocket>();
  private readonly reconnectAttempts = new Map<string, number>();
  private readonly reconnectTimers = new Map<string, NodeJS.Timeout>();
  private readonly stickyRenewalTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionCrypto: SessionCryptoService,
    private readonly proxyConfigService: ProxyConfigService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async startSession({ sessionId, userId, phoneNumber }: StartSessionParams): Promise<void> {
    this.clearReconnectTimer(sessionId);
    if (this.sockets.has(sessionId)) return; // já ativa — idempotente

    const agents = await this.prepareProxyAgents(sessionId, userId, phoneNumber);
    if (agents === 'proxy_failed') return; // já logou, emitiu update e agendou retry — não abre socket sem proxy funcional

    const { state, saveCreds } = await useDbAuthState(this.prisma, this.sessionCrypto, sessionId, userId);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      version,
      auth: state,
      browser: Browsers.ubuntu('ZaBot'),
      printQRInTerminal: false,
      syncFullHistory: false,
      logger: silentBaileysLogger(),
      ...(agents ? { agent: agents.agent, fetchAgent: agents.fetchAgent } : {}),
    });

    this.sockets.set(sessionId, { socket, userId, phoneNumber });
    if (agents) this.scheduleStickyRenewal(sessionId, userId, phoneNumber);
    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('connection.update', (update) => {
      void this.handleConnectionUpdate(sessionId, userId, socket, update);
    });

    if (phoneNumber && !state.creds.registered) {
      try {
        const digitsOnly = phoneNumber.replace(/\D/g, '');
        const code = await socket.requestPairingCode(digitsOnly);
        this.updates.next({ sessionId, status: 'CONECTANDO', pairingCode: code });
      } catch (err) {
        this.logger.error(
          { event: 'whatsapp_pairing_code_error', sessionId, err },
          'Falha ao solicitar código de pareamento ao WhatsApp',
        );
      }
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    this.clearReconnectTimer(sessionId);
    this.clearStickyRenewalTimer(sessionId);
    this.reconnectAttempts.delete(sessionId);

    const active = this.sockets.get(sessionId);
    this.sockets.delete(sessionId);
    if (!active) return;

    try {
      await active.socket.logout();
    } catch (err) {
      this.logger.warn(
        { event: 'whatsapp_logout_error', sessionId, err },
        'Falha ao avisar o WhatsApp do logout (socket já pode estar morto) — encerrando localmente mesmo assim',
      );
    }
    active.socket.end(undefined);

    await clearAuthState(this.prisma, sessionId, active.userId);
    this.updates.next({
      sessionId,
      status: 'DESCONECTADA',
      disconnectReason: 'desconectado_pelo_usuario',
      loggedOut: true,
    });
  }

  /**
   * Etapa 13 (README raiz §5 passo 3) — uma única chamada `onWhatsApp` para
   * todos os candidatos de um contato, em vez de uma chamada por candidato
   * (menos round-trips, menos "fingerprint" de verificação no WhatsApp).
   * A API do Baileys pode omitir do array de retorno os JIDs que não
   * existem (ver doc: `const [result] = await sock.onWhatsApp(jid)` já trata
   * `result` como possivelmente `undefined`) — por isso o resultado é
   * construído a partir do conjunto dos que *vieram* com `exists: true`,
   * nunca assumindo posição/ordem do array de retorno.
   */
  async checkNumbers(sessionId: string, candidates: string[]): Promise<NumberCheckResult[]> {
    const active = this.sockets.get(sessionId);
    if (!active) {
      throw new SessionNotConnectedError(
        'Sessão não está conectada — não é possível verificar números no WhatsApp agora.',
        { sessionId },
      );
    }
    if (candidates.length === 0) return [];

    const jids = candidates.map((candidate) => `${candidate}@s.whatsapp.net`);
    const results = await active.socket.onWhatsApp(...jids);
    const existing = new Set(
      (results ?? [])
        .filter((result) => result.exists)
        .map((result) => result.jid.split('@')[0].split(':')[0]),
    );

    return candidates.map((candidate) => ({ candidate, exists: existing.has(candidate) }));
  }

  /**
   * Etapa 15 (README raiz §6/15) — envia texto e/ou mídia para um único
   * destinatário. Estratégia de legenda (`caption`), decisão só do Baileys
   * (o resto do backend não conhece essa peculiaridade — ver
   * `SendMessageParams`):
   *  - IMAGENS/DOCUMENTO suportam legenda: o `text` (já personalizado) vira
   *    a legenda do PRIMEIRO item de mídia; itens seguintes (mais de uma
   *    imagem — README §5/13 "várias imagens na mesma mensagem") vão sem
   *    legenda, em sequência.
   *  - AUDIO não suporta legenda no WhatsApp: se houver `text`, ele sai como
   *    mensagem de texto própria antes do áudio.
   *  - Sem mídia nenhuma, `text` vira uma mensagem de texto simples.
   * Uma campanha sem nenhuma mensagem e sem mídia (nunca deveria acontecer —
   * `CampaignsService` exige ao menos 1 mensagem) não envia nada e retorna
   * sem erro, por segurança.
   */
  async sendMessage(sessionId: string, { to, text, media }: SendMessageParams): Promise<void> {
    const active = this.sockets.get(sessionId);
    if (!active) {
      throw new SessionNotConnectedError(
        'Sessão não está conectada — não é possível enviar mensagem agora.',
        { sessionId },
      );
    }

    const jid = `${to}@s.whatsapp.net`;
    const items = media ?? [];

    if (items.length === 0) {
      if (!text) return;
      await active.socket.sendMessage(jid, { text });
      return;
    }

    const [first, ...rest] = items;
    const captionSupported = first.type !== 'AUDIO';

    if (!captionSupported && text) {
      await active.socket.sendMessage(jid, { text });
    }

    await active.socket.sendMessage(jid, this.buildMediaContent(first, captionSupported ? text : undefined));
    for (const item of rest) {
      await active.socket.sendMessage(jid, this.buildMediaContent(item, undefined));
    }
  }

  /** Monta o payload de mídia no formato que `WASocket.sendMessage` espera para cada categoria. */
  private buildMediaContent(item: OutgoingMedia, caption: string | undefined): Parameters<WASocket['sendMessage']>[1] {
    switch (item.type) {
      case 'IMAGENS':
        return { image: item.buffer, mimetype: item.mimeType, caption };
      case 'AUDIO':
        return { audio: item.buffer, mimetype: item.mimeType, ptt: false };
      case 'DOCUMENTO':
        return { document: item.buffer, mimetype: item.mimeType, caption, fileName: item.filename ?? 'documento' };
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    for (const timer of this.stickyRenewalTimers.values()) clearTimeout(timer);
    for (const { socket } of this.sockets.values()) socket.end(undefined);
  }

  private async handleConnectionUpdate(
    sessionId: string,
    userId: string,
    socket: WASocket,
    update: Partial<ConnectionState>,
  ): Promise<void> {
    // Socket superado (já trocado por stopSession/reconexão) — ignora
    // eventos tardios de uma conexão que não é mais a atual.
    if (this.sockets.get(sessionId)?.socket !== socket) return;

    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        const qrImage = await QRCode.toDataURL(qr);
        this.updates.next({ sessionId, status: 'CONECTANDO', qr: qrImage });
      } catch (err) {
        this.logger.error({ event: 'whatsapp_qr_render_error', sessionId, err }, 'Falha ao renderizar QR code');
      }
    }

    if (connection === 'open') {
      this.reconnectAttempts.delete(sessionId);
      const waNumber = socket.user?.id?.split(':')[0]?.split('@')[0];
      this.updates.next({ sessionId, status: 'CONECTADA', phoneNumber: waNumber });
      return;
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
        ?.statusCode;
      const reasonLabel = this.describeDisconnect(statusCode);
      const definitive = this.isDefinitive(statusCode);
      const phoneNumber = this.sockets.get(sessionId)?.phoneNumber;

      this.sockets.delete(sessionId);
      this.clearStickyRenewalTimer(sessionId);

      if (definitive) {
        await clearAuthState(this.prisma, sessionId, userId);
        this.logger.warn(
          { event: 'whatsapp_session_ended', sessionId, reason: reasonLabel },
          'Sessão encerrada definitivamente — auth state removido, QR/pareamento novo necessário',
        );
        this.updates.next({ sessionId, status: 'DESCONECTADA', disconnectReason: reasonLabel, loggedOut: true });
        return;
      }

      this.logger.warn(
        { event: 'whatsapp_connection_dropped', sessionId, reason: reasonLabel },
        'Conexão caiu — agendando reconexão automática',
      );
      this.updates.next({ sessionId, status: 'CONECTANDO', disconnectReason: reasonLabel });
      this.scheduleReconnect(sessionId, userId, phoneNumber);
    }
  }

  private scheduleReconnect(sessionId: string, userId: string, phoneNumber?: string): void {
    const attempts = (this.reconnectAttempts.get(sessionId) ?? 0) + 1;
    this.reconnectAttempts.set(sessionId, attempts);
    const delay = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** attempts, MAX_RECONNECT_DELAY_MS);

    const timer = setTimeout(() => {
      this.startSession({ sessionId, userId, phoneNumber }).catch((err) =>
        this.logger.error({ event: 'whatsapp_reconnect_error', sessionId, err }, 'Falha ao tentar reconectar sessão'),
      );
    }, delay);
    this.reconnectTimers.set(sessionId, timer);
  }

  private clearReconnectTimer(sessionId: string): void {
    const timer = this.reconnectTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(sessionId);
    }
  }

  /**
   * Garante os agents de proxy antes de abrir o socket Baileys — busca/cria
   * a `ProxyConfig`, testa conectividade real através dela e trata falha de
   * proxy como falha de conexão (README §4): loga causa categorizada, agenda
   * reconexão com backoff e devolve o sentinel `'proxy_failed'` para
   * `startSession` abortar sem abrir socket. Retorna `undefined` quando o
   * proxy está desabilitado no ambiente (sem `DATAIMPULSE_HOST`).
   */
  private async prepareProxyAgents(
    sessionId: string,
    userId: string,
    phoneNumber?: string,
  ): Promise<ProxyAgents | undefined | 'proxy_failed'> {
    const proxyConfig = await this.proxyConfigService.getOrCreateConfig(userId, sessionId);
    if (!proxyConfig) return undefined;

    const agents = this.proxyConfigService.buildAgents(proxyConfig);
    const result = await this.proxyConfigService.testConnectivity(agents);
    await this.proxyConfigService.recordTestResult(userId, sessionId, result);

    if (!result.ok) {
      const reason = result.error ?? 'proxy_erro_desconhecido';
      this.logger.error(
        { event: 'whatsapp_proxy_connectivity_error', sessionId, reason },
        'Falha de conectividade do proxy — tratada como falha de conexão',
      );
      this.updates.next({ sessionId, status: 'CONECTANDO', disconnectReason: reason });
      this.scheduleReconnect(sessionId, userId, phoneNumber);
      return 'proxy_failed';
    }

    return agents;
  }

  /**
   * Agenda a renovação da sticky key com a folga de
   * `STICKY_RENEWAL_BUFFER_MINUTES` antes do limite contratado no
   * DataImpulse — nunca em cima da hora (README §4). A renovação em si
   * (`performStickyRenewal`) é um ciclo de reconexão controlado, nunca uma
   * troca de IP no meio de uma conexão aberta.
   */
  private scheduleStickyRenewal(sessionId: string, userId: string, phoneNumber?: string): void {
    const stickyMinutes = this.proxyConfigService.stickyMinutes();
    const delay = Math.max((stickyMinutes - STICKY_RENEWAL_BUFFER_MINUTES) * 60_000, MIN_STICKY_RENEWAL_DELAY_MS);

    const timer = setTimeout(() => {
      this.performStickyRenewal(sessionId, userId, phoneNumber).catch((err) =>
        this.logger.error(
          { event: 'whatsapp_sticky_renewal_error', sessionId, err },
          'Falha ao renovar sticky session do proxy',
        ),
      );
    }, delay);
    this.stickyRenewalTimers.set(sessionId, timer);
  }

  /**
   * Executa a renovação: gira a `stickyKey` no banco (novo IP no próximo
   * agent) e reabre o socket via o ciclo normal `startSession` — sem
   * `.logout()`, sem limpar auth state, é só uma reconexão de rotina.
   * Ignorada silenciosamente se a sessão já não estiver mais ativa (foi
   * parada ou caiu e está aguardando reconexão por outro caminho).
   */
  private async performStickyRenewal(sessionId: string, userId: string, phoneNumber?: string): Promise<void> {
    const active = this.sockets.get(sessionId);
    if (!active) return;

    await this.proxyConfigService.rotateStickyKey(userId, sessionId);
    this.updates.next({ sessionId, status: 'CONECTANDO', disconnectReason: 'renovacao_proxy_agendada' });

    this.sockets.delete(sessionId);
    active.socket.end(undefined);

    await this.startSession({ sessionId, userId, phoneNumber });
  }

  private clearStickyRenewalTimer(sessionId: string): void {
    const timer = this.stickyRenewalTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.stickyRenewalTimers.delete(sessionId);
    }
  }

  /** true = credenciais mortas, reconectar automaticamente não adianta. */
  private isDefinitive(statusCode?: number): boolean {
    return (
      statusCode === DisconnectReason.loggedOut ||
      statusCode === DisconnectReason.connectionReplaced ||
      statusCode === DisconnectReason.badSession
    );
  }

  /** Causa categorizada da queda — nunca um "erro genérico" no log (ver README). */
  private describeDisconnect(statusCode?: number): string {
    switch (statusCode) {
      case DisconnectReason.loggedOut:
        return 'logout_definitivo';
      case DisconnectReason.connectionReplaced:
        return 'sessao_substituida_por_outro_dispositivo';
      case DisconnectReason.badSession:
        return 'sessao_invalida';
      case DisconnectReason.restartRequired:
        return 'restart_exigido_pelo_whatsapp';
      // timedOut e connectionLost compartilham o código 408 na lib — um único
      // case (switch casa pelo valor, não pelo nome do enum).
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
        return statusCode ? `codigo_${statusCode}` : 'motivo_desconhecido';
    }
  }
}
