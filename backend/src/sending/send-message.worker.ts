import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { getRedisConnectionOptions } from '../queue/redis-connection';
import { sendMessageQueueName, SendMessageJobData } from './send-message.queue';
import { SendMessageProcessorService } from './send-message-processor.service';

/**
 * Consumidor das filas `queue:send-message:<sessionId>` — contraparte de
 * `SendMessageQueueService` (que só produz, nunca abre um `Worker` — README
 * raiz §6/15). Um `Worker` BullMQ por sessão, concorrência 1 (é o próprio
 * mecanismo de rate limit/anti-ban — ver `AntiBanService` e o comentário em
 * `SendMessageProcessorService`), criado sob demanda por `ensureWorker()`,
 * chamado por `SendMessageQueueService.enqueueCampaign` logo depois de
 * enfileirar os jobs de uma campanha — nunca antecipadamente, mesmo padrão
 * de `getQueue()` no lado produtor. `queueName` vem da função pura
 * `sendMessageQueueName` (não do método da classe) para não criar um ciclo
 * de injeção de dependência entre os dois serviços.
 *
 * Fora do escopo desta etapa, deliberadamente (mesmo espírito do comentário
 * em `SessionService` sobre não retomar sessões WhatsApp sozinho depois do
 * processo reiniciar): reconciliação automática, no boot, de um `Worker`
 * para sessões que já tinham jobs pendentes no Redis antes do processo
 * cair. Como qualquer campanha nova da mesma sessão chama `ensureWorker()`
 * de novo, o `Worker` sempre volta a existir na próxima campanha; jobs
 * remanescentes de antes do restart (ex.: reagendados para fora da janela
 * de horário) só seriam retomados então. Resolver isso de verdade exigiria
 * listar sessões de TODOS os usuários no boot, o que hoje não dá para fazer
 * sem contornar o RLS por-tenant do Prisma (`PrismaService.withTenantContext`
 * exige um `userId` por chamada) — um bypass assim não existe em nenhum
 * outro lugar do código, então não é introduzido aqui sem necessidade
 * comprovada em produção.
 */
@Injectable()
export class SendMessageWorker implements OnModuleDestroy {
  private readonly workers = new Map<string, Worker<SendMessageJobData>>();
  private readonly maxAttempts: number;

  constructor(
    private readonly processor: SendMessageProcessorService,
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {
    this.maxAttempts = this.config.get<number>('SEND_MAX_ATTEMPTS') ?? 5;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.workers.values()].map((worker) => worker.close()));
  }

  /** Garante que existe um `Worker` consumindo a fila desta sessão — idempotente (no-op se já existe). */
  ensureWorker(sessionId: string): void {
    if (this.workers.has(sessionId)) return;

    const worker = new Worker<SendMessageJobData>(
      sendMessageQueueName(sessionId),
      (job) => this.processor.process(job.data),
      { connection: getRedisConnectionOptions(), concurrency: 1 },
    );

    worker.on('failed', (job, err) => {
      void this.handleFailed(job, err);
    });

    this.workers.set(sessionId, worker);
  }

  /**
   * Listener `failed` do BullMQ dispara a cada tentativa que lançou (mesmo
   * quando ainda vai reagendar com backoff — `SendMessageProcessorService.process`
   * já persistiu a tentativa/motivo antes de relançar). Só quando
   * `attemptsMade` já esgotou o total configurado (`attempts` da fila,
   * `SendMessageQueueService`) é que a falha é DEFINITIVA e `finalizeFailure`
   * roda a transição terminal — nunca antes disso.
   */
  private async handleFailed(job: Job<SendMessageJobData> | undefined, err: Error): Promise<void> {
    if (!job) return; // BullMQ pode chamar 'failed' sem job em erro de conexão/pré-processamento, nada a finalizar

    const configuredAttempts = job.opts.attempts ?? this.maxAttempts;
    if (job.attemptsMade < configuredAttempts) return; // ainda vai tentar de novo — não é falha definitiva

    try {
      await this.processor.finalizeFailure(job.data, job.attemptsMade, err);
    } catch (finalizeErr) {
      this.logger.error(
        {
          event: 'send_message_finalize_failure_error',
          envioId: job.data.envioId,
          userId: job.data.userId,
          sessionId: job.data.sessionId,
          err: finalizeErr,
        },
        'Falha ao finalizar Envio como FALHOU definitivo depois de esgotar tentativas — Envio pode ficar preso sem transição terminal',
      );
    }
  }
}
