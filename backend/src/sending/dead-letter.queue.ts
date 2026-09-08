import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { attachQueueFailureLogging } from '../queue/queue-events.helper';
import { getRedisConnectionOptions } from '../queue/redis-connection';

export const DEAD_LETTER_QUEUE = 'dead-letter';

export interface DeadLetterJobData {
  envioId: string;
  campaignId: string;
  userId: string;
  sessionId: string;
  /** Causa categorizada da falha definitiva — nunca "erro genérico" (ver README raiz seção de logging). */
  reason: string;
  attemptsMade: number;
}

/**
 * Fila única `queue:dead-letter` (README raiz §6/15 — "falhas definitivas
 * vão para fila dead-letter para análise"). Diferente de
 * `queue:send-message:<sessionId>`, não há um worker automático consumindo
 * esta fila: o Postgres já é a fonte de verdade da falha (`Envio.status =
 * FALHOU` + `failureReason`, gravados por `SendMessageProcessor` ANTES de
 * chamar `push()` aqui) — esta fila existe só como trilha operacional em
 * Redis (inspecionável via Bull Board/CLI) para quem for investigar um
 * padrão de falha (ex.: muitos envios definitivos para o mesmo DDD),
 * sem precisar reprocessar nada automaticamente.
 */
@Injectable()
export class DeadLetterQueueService implements OnModuleInit, OnModuleDestroy {
  private queue!: Queue<DeadLetterJobData>;
  private queueEvents!: QueueEvents;

  constructor(private readonly logger: Logger) {}

  onModuleInit(): void {
    this.queue = new Queue<DeadLetterJobData>(DEAD_LETTER_QUEUE, {
      connection: getRedisConnectionOptions(),
      defaultJobOptions: { removeOnComplete: { age: 604_800 }, removeOnFail: { age: 604_800 } },
    });
    this.queueEvents = attachQueueFailureLogging(DEAD_LETTER_QUEUE, this.logger);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.queueEvents.close();
  }

  async push(data: DeadLetterJobData): Promise<void> {
    await this.queue.add('falha-definitiva', data);
  }
}
