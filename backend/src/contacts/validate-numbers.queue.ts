import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { attachQueueFailureLogging } from '../queue/queue-events.helper';
import { getRedisConnectionOptions } from '../queue/redis-connection';

export const VALIDATE_NUMBERS_QUEUE = 'validate-numbers';

export interface ValidateNumberJobData {
  contactId: string;
  userId: string;
}

/**
 * Produtor da fila `queue:validate-numbers` (README raiz §6 — pipeline
 * "Importação → Normalização/validação (assíncrono, em fila própria) →
 * Contatos prontos para campanha"). Fio manual de BullMQ, mesmo padrão de
 * `redis-connection.ts`/`queue-events.helper.ts` (etapa 9) — o projeto não
 * usa `@nestjs/bullmq`. `ContactsService` chama `enqueue()` depois de criar
 * um contato PENDENTE; sem `jobId` fixo de propósito — reenfileirar o mesmo
 * contato (ex.: `updateContact` corrigindo o telefone) sempre entra como job
 * novo, e o worker é idempotente contra jobs duplicados (ver
 * `ValidateNumbersWorker.process`).
 */
@Injectable()
export class ValidateNumbersQueueService implements OnModuleInit, OnModuleDestroy {
  private queue!: Queue<ValidateNumberJobData>;
  private queueEvents!: QueueEvents;

  constructor(private readonly logger: Logger) {}

  onModuleInit(): void {
    this.queue = new Queue<ValidateNumberJobData>(VALIDATE_NUMBERS_QUEUE, {
      connection: getRedisConnectionOptions(),
      defaultJobOptions: {
        // Sessão desconectada é a única causa de retry esperada (ver worker)
        // — poucas tentativas com backoff exponencial bastam; passado isso o
        // contato fica PENDENTE com failureReason categorizado, sem loop
        // infinito de reprocessamento.
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 3_600 },
        removeOnFail: { age: 86_400 },
      },
    });
    this.queueEvents = attachQueueFailureLogging(VALIDATE_NUMBERS_QUEUE, this.logger);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.queueEvents.close();
  }

  async enqueue(data: ValidateNumberJobData): Promise<void> {
    await this.queue.add('verificar', data);
  }
}
