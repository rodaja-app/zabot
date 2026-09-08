import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import { attachQueueFailureLogging } from '../queue/queue-events.helper';
import { getRedisConnectionOptions } from '../queue/redis-connection';
import { SessionService } from '../whatsapp/session.service';

/** Prefixo do nome da fila BullMQ por sessão — nome final é `send-message:<sessionId>` (README raiz diagrama: "queue:send-message, uma por sessão, com rate limit"). */
export const SEND_MESSAGE_QUEUE_PREFIX = 'send-message';

/**
 * Nome da fila BullMQ de uma sessão, como função pura sem dependências —
 * extraída para fora da classe para que `SendMessageWorker` (lado
 * consumidor) possa calcular o mesmo nome sem precisar injetar
 * `SendMessageQueueService` inteiro (que por sua vez não conhece
 * `SendMessageWorker` — ver comentário em `enqueueCampaign` sobre por que
 * essa dependência é deliberadamente unidirecional).
 */
export function sendMessageQueueName(sessionId: string): string {
  return `${SEND_MESSAGE_QUEUE_PREFIX}:${sessionId}`;
}

export interface SendMessageJobData {
  envioId: string;
  userId: string;
  sessionId: string;
}

/**
 * Produtor das filas `queue:send-message:<sessionId>` (etapa 15 — README
 * raiz §6: "Criação da campanha → gera 1 job por (contato × mensagem) na
 * fila de envio"). Uma `Queue` BullMQ por sessão (criada sob demanda, nunca
 * antecipadamente) permite que cada sessão WhatsApp tenha seu próprio
 * throughput/rampa de aquecimento sem uma fila competir com a de outro
 * usuário — `Session` é 1:1 por usuário (ver schema.prisma), então a chave
 * de particionamento (`sessionId`) é estável pela vida inteira da conta.
 *
 * `CampaignsService.createCampaign` chama `enqueueCampaign()` depois de
 * persistir a campanha (mesmo padrão de `ContactsService` → `ValidateNumbersQueueService.enqueue()`
 * após criar um contato) — este serviço nunca decide "o que enviar", só lê
 * os `Envio`s PENDENTE já persistidos pela etapa 14 e os transforma em jobs.
 * `jobId = envioId` torna `enqueueCampaign` idempotente contra chamadas
 * duplicadas (ex.: retry de rede na própria criação da campanha).
 */
@Injectable()
export class SendMessageQueueService implements OnModuleDestroy {
  private readonly queues = new Map<string, Queue<SendMessageJobData>>();
  private readonly queueEvents = new Map<string, QueueEvents>();
  private readonly maxAttempts: number;
  private readonly backoffDelayMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {
    this.maxAttempts = this.config.get<number>('SEND_MAX_ATTEMPTS') ?? 5;
    this.backoffDelayMs = this.config.get<number>('SEND_BACKOFF_DELAY_MS') ?? 10_000;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    await Promise.all([...this.queueEvents.values()].map((q) => q.close()));
  }

  /** Nome da fila BullMQ de uma sessão — delega para a função pura `sendMessageQueueName` (ver comentário lá). */
  queueName(sessionId: string): string {
    return sendMessageQueueName(sessionId);
  }

  /**
   * Lê todos os `Envio` PENDENTE de uma campanha recém-criada e enfileira 1
   * job por envio na fila da sessão do usuário; também soma ao contador
   * agregado `Session.messagesPending` (README §3/13 — resumo em tempo real
   * da Tela Início, distinto de `Campaign.pendingCount`, que é por
   * CONTATO — ver `SendMessageProcessor`) e publica o novo total via
   * `SessionService.publishStats`. Sem efeito (retorna `undefined` cedo) se
   * a campanha não tiver nenhum `Envio` pendente (ex.: `recipientCount ===
   * 0`, já nasce ENVIADA na etapa 14).
   *
   * Retorna o `sessionId` da fila usada (ou `undefined` se não enfileirou
   * nada) para que o chamador (`CampaignsService`, via `sending.module.ts`)
   * possa garantir um `Worker` consumindo-a com `SendMessageWorker.ensureWorker(sessionId)`
   * — deliberadamente NÃO chamado daqui: este serviço não conhece
   * `SendMessageWorker` (ver docstring da classe, "nunca decide o que
   * enviar"/só decide "o que produzir"), e injetar o worker aqui criaria um
   * ciclo de DI, já que `SendMessageWorker` importa `sendMessageQueueName`
   * deste mesmo arquivo.
   */
  async enqueueCampaign(userId: string, campaignId: string): Promise<string | undefined> {
    const envios = await this.prisma.withTenantContext(userId, (tx) =>
      tx.envio.findMany({ where: { campaignId, status: 'PENDENTE' }, select: { id: true } }),
    );
    if (envios.length === 0) return undefined;

    const session = await this.sessionService.getOrCreateSession(userId);
    const queue = this.getQueue(session.id);

    await queue.addBulk(
      envios.map((envio) => ({
        name: 'enviar',
        data: { envioId: envio.id, userId, sessionId: session.id },
        opts: { jobId: envio.id },
      })),
    );

    const updated = await this.prisma.withTenantContext(userId, (tx) =>
      tx.session.update({ where: { userId }, data: { messagesPending: { increment: envios.length } } }),
    );
    this.sessionService.publishStats(userId, {
      contactsImported: updated.contactsImported,
      messagesSent: updated.messagesSent,
      messagesPending: updated.messagesPending,
      failures: updated.failures,
    });

    return session.id;
  }

  /**
   * Reenfileira um único envio com um atraso explícito (ms) — usado pelo
   * `SendMessageProcessor` quando o horário atual cai fora da janela de
   * envio do fuso do contato (README §15). Não conta como tentativa nova
   * nem mexe em contadores — o job original já foi concluído normalmente
   * pelo worker, isto é só o próximo agendamento.
   */
  async reschedule(sessionId: string, data: SendMessageJobData, delayMs: number): Promise<void> {
    const queue = this.getQueue(sessionId);
    // jobId com sufixo de tentativa: um `envioId` que já foi reagendado antes
    // (ex.: caiu fora da janela de novo, depois de outra falha/retry) não
    // colide com o job anterior do mesmo id, que já foi removido ao completar.
    await queue.add('enviar', data, { delay: delayMs, jobId: `${data.envioId}:reagendado:${Date.now()}` });
  }

  private getQueue(sessionId: string): Queue<SendMessageJobData> {
    const existing = this.queues.get(sessionId);
    if (existing) return existing;

    const name = this.queueName(sessionId);
    const queue = new Queue<SendMessageJobData>(name, {
      connection: getRedisConnectionOptions(),
      defaultJobOptions: {
        attempts: this.maxAttempts,
        backoff: { type: 'exponential', delay: this.backoffDelayMs },
        removeOnComplete: { age: 3_600 },
        removeOnFail: { age: 86_400 },
      },
    });
    this.queues.set(sessionId, queue);
    this.queueEvents.set(sessionId, attachQueueFailureLogging(name, this.logger));
    return queue;
  }
}
