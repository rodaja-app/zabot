import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import * as https from 'node:https';
import type { Agent } from 'node:https';
import { Logger } from 'nestjs-pino';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { Prisma, ProxyConfig, ProxyProtocol } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SessionCryptoService } from '../common/security/session-crypto.service';

const PROXY_TEST_URL = 'https://web.whatsapp.com/';
const PROXY_TEST_TIMEOUT_MS = 10_000;

export interface ProxyAgents {
  agent: Agent;
  fetchAgent: Agent;
}

export interface ProxyConnectivityResult {
  ok: boolean;
  /** Causa categorizada — nunca um erro genérico (ver README §2 do projeto: "todo erro é logado com sua causa real"). */
  error?: string;
}

/**
 * Gestão de proxy por sessão WhatsApp via DataImpulse (README raiz §4, etapa
 * 12). Deliberadamente sem rota/DTO para o usuário: "toda a gestão (cadastro,
 * teste de conectividade, rotação, falha de proxy) fica inteiramente no
 * backend" — a conta DataImpulse (`DATAIMPULSE_HOST/PORT/USERNAME/PASSWORD`,
 * ver env.validation.ts) é uma só para toda a aplicação; o que isola cada
 * sessão é a `stickyKey` (parâmetro `sessid` do username DataImpulse — ver
 * https://docs.dataimpulse.com/proxies/parameters/session-id), gerada aqui e
 * rotacionada periodicamente por `BaileysWhatsAppProvider` antes do IP sticky
 * expirar.
 *
 * Se `DATAIMPULSE_HOST` não estiver setado no ambiente, `isEnabled` é falso e
 * as sessões conectam direto, sem proxy — suficiente para dev local sem conta
 * DataImpulse (mesma filosofia do `EmailProvider` log-only sem SMTP_HOST).
 */
@Injectable()
export class ProxyConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: SessionCryptoService,
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {}

  get isEnabled(): boolean {
    return Boolean(this.config.get<string>('DATAIMPULSE_HOST'));
  }

  /** Duração contratada da sessão sticky (env `DATAIMPULSE_STICKY_MINUTES`, padrão 30 min) — usado por `BaileysWhatsAppProvider` para agendar a renovação com folga. */
  stickyMinutes(): number {
    return this.config.get<number>('DATAIMPULSE_STICKY_MINUTES') ?? 30;
  }

  /** Lê a config de proxy da sessão, criando com uma `stickyKey` nova no primeiro acesso. `undefined` quando o proxy não está habilitado no ambiente. */
  async getOrCreateConfig(userId: string, sessionId: string): Promise<ProxyConfig | undefined> {
    if (!this.isEnabled) return undefined;

    return this.prisma.withTenantContext(userId, async (tx) => {
      const existing = await tx.proxyConfig.findUnique({ where: { sessionId } });
      if (existing) return existing;
      return this.createConfig(tx, userId, sessionId);
    });
  }

  /** Gera e persiste uma `stickyKey` nova (novo IP no DataImpulse) — chamado pelo worker pouco antes do limite da sessão sticky, nunca no meio de uma operação (ver README §4). */
  async rotateStickyKey(userId: string, sessionId: string): Promise<ProxyConfig> {
    return this.prisma.withTenantContext(userId, (tx) =>
      tx.proxyConfig.update({
        where: { sessionId },
        data: { stickyKey: randomStickyKey(), stickyRenewedAt: new Date() },
      }),
    );
  }

  /** Registra o resultado do teste de conectividade — nunca falha o fluxo do worker se a própria gravação der erro (só loga; teste em si já foi decidido antes de chamar isto). */
  async recordTestResult(userId: string, sessionId: string, result: ProxyConnectivityResult): Promise<void> {
    await this.prisma
      .withTenantContext(userId, (tx) =>
        tx.proxyConfig.update({
          where: { sessionId },
          data: { lastTestedAt: new Date(), lastTestOk: result.ok, lastTestError: result.error ?? null },
        }),
      )
      .catch((err) =>
        this.logger.error(
          { event: 'proxy_test_result_persist_error', sessionId, err },
          'Falha ao gravar resultado do teste de conectividade do proxy',
        ),
      );
  }

  /** Monta os `http.Agent` que o Baileys usa (`agent`/`fetchAgent` do `makeWASocket`) — decripta credenciais só aqui, dentro do processo do worker, nunca expostas fora dele. */
  buildAgents(proxyConfig: ProxyConfig): ProxyAgents {
    const { username, password } = this.decryptCredentials(proxyConfig);
    // Formato DataImpulse: LOGIN__sessid.<chave> — "enriquece" o login com o
    // parâmetro de sessão sticky (ver comentário do model no schema.prisma).
    const stickyUsername = `${username}__sessid.${proxyConfig.stickyKey}`;
    const auth = `${encodeURIComponent(stickyUsername)}:${encodeURIComponent(password)}`;
    const url = `${proxyConfig.protocol === ProxyProtocol.SOCKS5 ? 'socks5' : 'http'}://${auth}@${proxyConfig.host}:${proxyConfig.port}`;

    const agent: Agent =
      proxyConfig.protocol === ProxyProtocol.SOCKS5 ? new SocksProxyAgent(url) : new HttpsProxyAgent(url);
    return { agent, fetchAgent: agent };
  }

  /**
   * Testa conectividade real através do proxy antes de abrir o socket
   * Baileys — falha de proxy é tratada como falha de conexão (README §4),
   * então precisa de uma causa categorizada, nunca um erro genérico.
   */
  testConnectivity(agents: ProxyAgents): Promise<ProxyConnectivityResult> {
    return new Promise((resolve) => {
      const req = https.get(
        PROXY_TEST_URL,
        { agent: agents.agent, timeout: PROXY_TEST_TIMEOUT_MS },
        (res) => {
          res.resume(); // descarta o corpo — só o handshake/status importa para o teste
          resolve({ ok: (res.statusCode ?? 0) < 400 });
        },
      );
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'proxy_timeout' });
      });
      req.on('error', (err) => resolve({ ok: false, error: categorizeProxyError(err) }));
    });
  }

  private decryptCredentials(proxyConfig: ProxyConfig): { username: string; password: string } {
    const json = this.crypto
      .decrypt({
        ciphertext: proxyConfig.credentialsCiphertext,
        iv: proxyConfig.credentialsIv,
        authTag: proxyConfig.credentialsAuthTag,
      })
      .toString('utf8');
    return JSON.parse(json) as { username: string; password: string };
  }

  private createConfig(tx: Prisma.TransactionClient, userId: string, sessionId: string): Promise<ProxyConfig> {
    const username = this.config.getOrThrow<string>('DATAIMPULSE_USERNAME');
    const password = this.config.getOrThrow<string>('DATAIMPULSE_PASSWORD');
    const host = this.config.getOrThrow<string>('DATAIMPULSE_HOST');
    const protocol = (this.config.get<string>('DATAIMPULSE_PROTOCOL') ?? 'SOCKS5') as ProxyProtocol;
    const port = this.config.get<number>('DATAIMPULSE_PORT') ?? (protocol === ProxyProtocol.SOCKS5 ? 824 : 823);

    const { ciphertext, iv, authTag } = this.crypto.encrypt(
      Buffer.from(JSON.stringify({ username, password }), 'utf8'),
    );

    return tx.proxyConfig.create({
      data: {
        sessionId,
        userId,
        protocol,
        host,
        port,
        stickyKey: randomStickyKey(),
        credentialsCiphertext: ciphertext,
        credentialsIv: iv,
        credentialsAuthTag: authTag,
      },
    });
  }
}

function randomStickyKey(): string {
  return randomBytes(6).toString('hex');
}

/** Causa categorizada de falha de proxy a partir do erro real do Node/socks — nunca "erro genérico" no log (ver README raiz §9). */
function categorizeProxyError(err: unknown): string {
  const code = (err as { code?: string } | undefined)?.code;
  const message = (err as Error | undefined)?.message?.toLowerCase() ?? '';

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'proxy_host_nao_encontrado';
  if (code === 'ECONNREFUSED') return 'proxy_recusou_conexao';
  if (code === 'ECONNRESET') return 'proxy_conexao_resetada';
  if (code === 'ETIMEDOUT') return 'proxy_timeout';
  if (message.includes('auth') || message.includes('407')) return 'proxy_autenticacao_falhou';
  return code ? `proxy_erro_${code.toLowerCase()}` : 'proxy_erro_desconhecido';
}
