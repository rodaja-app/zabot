import { BadRequestException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { Observable, Subject } from 'rxjs';
import { Prisma, Session, SessionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SessionConnectionUpdate, WhatsAppProvider } from './whatsapp-provider.interface';

export interface SessionStats {
  contactsImported: number;
  messagesSent: number;
  messagesPending: number;
  failures: number;
}

/** `SessionConnectionUpdate` do provider + `userId` já resolvido — o gateway WS (tarefa #17) não conhece `sessionOwners` (privado deste serviço), só sabe transmitir por userId. */
export interface SessionEvent extends SessionConnectionUpdate {
  userId: string;
}

/** Renovação periódica do heartbeat de sharding enquanto este worker segura sessões ativas. */
const HEARTBEAT_INTERVAL_MS = 15_000;
/** 3x o intervalo — tolera um heartbeat perdido isolado sem trocar a sessão de dono cedo demais. */
const HEARTBEAT_STALE_MS = 45_000;
const RECOVERY_INTERVAL_MS = 30_000;

/**
 * Orquestra o ciclo de vida da sessão WhatsApp de cada usuário (README §3/13):
 * cria/lê o registro `Session` (1:1 por usuário — ver schema.prisma), decide
 * quem "é dono" da sessão entre workers (`workerId`/`workerHeartbeatAt`),
 * aciona o `WhatsAppProvider` (Baileys por trás da abstração) e persiste de
 * volta no Postgres tudo que chega pelo stream `connectionUpdates$` do
 * provider. `SessionController` (REST) e o futuro gateway WebSocket (tarefa
 * #17) só conhecem este serviço — nunca o provider diretamente.
 *
 * Sharding: `sessionOwners` é a lista, só em memória deste processo, das
 * sessões cujo socket Baileys ESTE worker abriu (`connect()`/`startSession`).
 * Só sessões nesta lista têm heartbeat renovado por este worker e só update
 * de eventos delas são persistidos aqui — evita um worker escrever por cima
 * do estado de uma sessão que outro worker está de fato segurando.
 *
 * Fora do escopo desta etapa, deliberadamente: retomada automática de
 * sessões após o PRÓPRIO processo reiniciar (ex.: redeploy no Railway
 * enquanto uma sessão estava CONECTADA). O fluxo do front sempre parte de um
 * `connect()` explícito do usuário — não há tela que espere reconexão
 * "sozinha" depois de o processo cair. Se isso vier a ser necessário, é um
 * job de reconciliação periódico separado, não uma mudança neste serviço.
 */
@Injectable()
export class SessionService implements OnModuleInit, OnModuleDestroy {
  private readonly workerId: string;
  private readonly sessionOwners = new Map<string, string>(); // sessionId -> userId
  /** Último QR/código transitório por sessão deste worker; permite recuperar
   * a tela quando o WebSocket reconecta depois de o evento original chegar. */
  private readonly liveConnectionUpdates = new Map<string, SessionConnectionUpdate>();
  private heartbeatTimer?: NodeJS.Timeout;
  private recoveryTimer?: NodeJS.Timeout;
  private readonly events = new Subject<SessionEvent>();

  /** Re-emissão dos eventos do provider, já filtrados para sessões deste worker — consumido pelo gateway WS (tarefa #17). */
  readonly events$: Observable<SessionEvent> = this.events.asObservable();

  private readonly statsEvents = new Subject<{ userId: string } & SessionStats>();

  /**
   * Stream de atualização de estatísticas em tempo real (README §3/13 —
   * "estatísticas do resumo em tempo real"). Ninguém incrementa
   * `contactsImported`/`messagesSent`/etc. ainda nesta etapa (isso é dos
   * motores de contatos/envio — etapas 13/14/15); o transporte já existe
   * agora para que aquelas etapas só precisem chamar `publishStats()` depois
   * de gravar no banco, sem precisar tocar no gateway.
   */
  readonly statsEvents$: Observable<{ userId: string } & SessionStats> = this.statsEvents.asObservable();

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: WhatsAppProvider,
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {
    // Estável se WORKER_ID foi setado (múltiplas réplicas — ver env.validation.ts),
    // senão um uuid novo por subida do processo (suficiente para 1 réplica).
    this.workerId = this.config.get<string>('WORKER_ID') ?? randomUUID();
  }

  onModuleInit(): void {
    this.provider.connectionUpdates$.subscribe((update) => {
      void this.handleProviderUpdate(update);
    });
    this.heartbeatTimer = setInterval(() => void this.renewHeartbeats(), HEARTBEAT_INTERVAL_MS);
    // Um redeploy não deve exigir que o usuário escaneie QR de novo. Depois
    // que as credenciais já foram persistidas, retomamos sessões marcadas
    // como conectadas assim que este worker puder reivindicá-las com segurança.
    setTimeout(() => void this.recoverConnectedSessions(), 2_000);
    this.recoveryTimer = setInterval(() => void this.recoverConnectedSessions(), RECOVERY_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
  }

  /** Busca a sessão do usuário, criando com os padrões do schema se ainda não existir (primeiro acesso). */
  async getOrCreateSession(userId: string): Promise<Session> {
    return this.prisma.withTenantContext(userId, async (tx) => {
      const existing = await tx.session.findUnique({ where: { userId } });
      if (existing) return existing;
      return tx.session.create({ data: { userId } });
    });
  }

  async getSessionSnapshot(userId: string): Promise<Session & Pick<SessionConnectionUpdate, 'qr' | 'pairingCode'>> {
    const session = await this.getOrCreateSession(userId);
    const live = this.liveConnectionUpdates.get(session.id);
    return {
      ...session,
      // Só expose valores de uma tentativa ainda em andamento; QR/código de
      // uma sessão conectada ou encerrada jamais reaparece no app.
      qr: session.status === 'CONECTANDO' ? live?.qr : undefined,
      pairingCode: session.status === 'CONECTANDO' ? live?.pairingCode : undefined,
    };
  }

  /** Equivalente a `ConnectionRepository.connect()` do front — inicia QR (sem `phoneNumber`) ou pareamento por código. */
  async connect(userId: string, phoneNumber?: string): Promise<void> {
    const session = await this.getOrCreateSession(userId);
    const claimed = await this.claimSession(userId, session.id);

    if (!claimed) {
      // Outro worker já segura esta sessão com heartbeat recente — não é
      // erro do usuário, é uma corrida entre requisições/instâncias.
      this.logger.warn(
        { event: 'whatsapp_session_claim_denied', sessionId: session.id, userId },
        'Sessão já ativa em outro worker (heartbeat recente) — pedido de conexão ignorado',
      );
      return;
    }

    this.sessionOwners.set(session.id, userId);
    await this.provider.startSession({ sessionId: session.id, userId, phoneNumber });
  }

  /** Equivalente a `ConnectionRepository.disconnect()` do front. */
  async disconnect(userId: string): Promise<void> {
    const session = await this.getOrCreateSession(userId);

    await this.provider.stopSession(session.id);
    this.sessionOwners.delete(session.id);
    await this.releaseClaim(userId, session.id);

    // Rede de segurança: reflete a intenção do usuário mesmo se este worker
    // não tinha o socket em memória (ex.: processo reiniciou depois de a
    // sessão ter conectado) — nesse caso `stopSession()` acima é um no-op
    // silencioso dentro do provider, e sem isto o registro ficaria "preso"
    // em CONECTADA/CONECTANDO indefinidamente.
    await this.prisma.withTenantContext(userId, (tx) =>
      tx.session.update({
        where: { userId },
        data: { status: 'DESCONECTADA', workerId: null, workerHeartbeatAt: null },
      }),
    );
  }

  /** Equivalente a `ConnectionRepository.renameSession()` do front. */
  async rename(userId: string, newName: string): Promise<Session> {
    const trimmed = newName.trim();
    if (!trimmed) {
      throw new BadRequestException('Nome da sessão não pode ser vazio.');
    }

    await this.getOrCreateSession(userId); // garante que a linha existe antes do update
    return this.prisma.withTenantContext(userId, (tx) =>
      tx.session.update({ where: { userId }, data: { name: trimmed } }),
    );
  }

  /** Equivalente a `ConnectionRepository.getStats()` do front — valores reais persistidos (nunca inventados, ver schema.prisma). */
  async getStats(userId: string): Promise<SessionStats> {
    const session = await this.getOrCreateSession(userId);
    return {
      contactsImported: session.contactsImported,
      messagesSent: session.messagesSent,
      messagesPending: session.messagesPending,
      failures: session.failures,
    };
  }

  /** Chamado pelos futuros motores de contatos/envio (etapas 13-15) depois de gravar novos contadores no banco — repassa ao gateway WS. */
  publishStats(userId: string, stats: SessionStats): void {
    this.statsEvents.next({ userId, ...stats });
  }

  /** Update condicional: só reivindica se ninguém dono agora, já é deste worker, ou o dono anterior está com heartbeat velho (morto/travado). */
  private async claimSession(userId: string, sessionId: string): Promise<boolean> {
    const staleThreshold = new Date(Date.now() - HEARTBEAT_STALE_MS);
    return this.prisma.withTenantContext(userId, async (tx) => {
      const result = await tx.session.updateMany({
        where: {
          id: sessionId,
          OR: [
            { workerId: null },
            { workerId: this.workerId },
            { workerHeartbeatAt: { lt: staleThreshold } },
          ],
        },
        data: { workerId: this.workerId, workerHeartbeatAt: new Date() },
      });
      return result.count > 0;
    });
  }

  private async releaseClaim(userId: string, sessionId: string): Promise<void> {
    await this.prisma.withTenantContext(userId, (tx) =>
      tx.session.updateMany({
        where: { id: sessionId, workerId: this.workerId },
        data: { workerId: null, workerHeartbeatAt: null },
      }),
    );
  }

  private async renewHeartbeats(): Promise<void> {
    for (const [sessionId, userId] of this.sessionOwners) {
      try {
        await this.prisma.withTenantContext(userId, (tx) =>
          tx.session.updateMany({
            where: { id: sessionId, workerId: this.workerId },
            data: { workerHeartbeatAt: new Date() },
          }),
        );
      } catch (err) {
        this.logger.error(
          { event: 'whatsapp_heartbeat_error', sessionId, err },
          'Falha ao renovar heartbeat de sharding da sessão — outro worker pode assumi-la achando-a morta',
        );
      }
    }
  }

  private async recoverConnectedSessions(): Promise<void> {
    try {
      // User não possui RLS (por desenho; ver schema.prisma). Cada leitura de
      // Session abaixo continua dentro de withTenantContext para preservar o
      // isolamento das tabelas de sessão.
      const users = await this.prisma.user.findMany({ select: { id: true } });
      for (const { id: userId } of users) {
        const session = await this.prisma.withTenantContext(userId, (tx) =>
          tx.session.findUnique({ where: { userId } }),
        );
        if (!session || session.status !== SessionStatus.CONECTADA || this.sessionOwners.has(session.id)) {
          continue;
        }
        const claimed = await this.claimSession(userId, session.id);
        if (!claimed) continue;

        this.sessionOwners.set(session.id, userId);
        try {
          await this.provider.startSession({ sessionId: session.id, userId });
          this.logger.log(
            { event: 'whatsapp_session_recovered', sessionId: session.id, userId },
            'Sessão WhatsApp recuperada após inicialização/redeploy',
          );
        } catch (err) {
          this.sessionOwners.delete(session.id);
          await this.releaseClaim(userId, session.id);
          this.logger.error(
            { event: 'whatsapp_session_recovery_error', sessionId: session.id, userId, err },
            'Falha ao recuperar sessão WhatsApp persistida; nova tentativa será feita automaticamente',
          );
        }
      }
    } catch (err) {
      this.logger.error(
        { event: 'whatsapp_session_recovery_scan_error', err },
        'Falha ao procurar sessões WhatsApp para recuperar; nova tentativa será feita automaticamente',
      );
    }
  }

  /** Único consumidor de `provider.connectionUpdates$` — persiste no Postgres e re-emite para `events$` (gateway WS). */
  private async handleProviderUpdate(update: SessionConnectionUpdate): Promise<void> {
    const userId = this.sessionOwners.get(update.sessionId);
    if (!userId) {
      // Evento de uma sessão que este worker não segura mais (ex.: já rodou
      // disconnect(), ou pertence a outra sessão de outro processo cujo
      // provider por algum motivo compartilhasse o mesmo barramento — não
      // deveria acontecer na prática, cada worker tem seu próprio provider).
      return;
    }

    this.liveConnectionUpdates.set(update.sessionId, update);

    const data: Prisma.SessionUpdateInput = { status: update.status };
    if (update.phoneNumber) data.phoneNumber = update.phoneNumber;
    if (update.disconnectReason) data.lastDisconnectReason = update.disconnectReason;
    if (update.status === 'CONECTADA') data.lastConnectedAt = new Date();

    try {
      await this.prisma.withTenantContext(userId, (tx) => tx.session.update({ where: { userId }, data }));
    } catch (err) {
      this.logger.error(
        { event: 'whatsapp_session_persist_error', sessionId: update.sessionId, userId, err },
        'Falha ao persistir atualização de status da sessão WhatsApp',
      );
    }

    if (update.loggedOut) {
      this.sessionOwners.delete(update.sessionId);
      this.liveConnectionUpdates.delete(update.sessionId);
      await this.releaseClaim(userId, update.sessionId).catch((err) =>
        this.logger.error(
          { event: 'whatsapp_release_claim_error', sessionId: update.sessionId, userId, err },
          'Falha ao liberar posse (workerId) da sessão após logout definitivo',
        ),
      );
    }

    this.events.next({ ...update, userId });
  }
}
