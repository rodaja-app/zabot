import { QueueEvents } from 'bullmq';
import { Logger } from 'nestjs-pino';
import * as Sentry from '@sentry/node';
import { getRedisConnectionOptions } from './redis-connection';

/**
 * Ponto único de captura de erro de fila. Toda fila criada nas próximas
 * etapas (import, validar-números, enviar-mensagem, dead-letter) chama isto
 * uma vez em vez de registrar o próprio listener de 'failed'/'error' — quem
 * cria a fila só passa o nome; log estruturado e Sentry saem de graça.
 *
 * Retorna a instância de `QueueEvents` para permitir `.close()` no shutdown.
 */
export function attachQueueFailureLogging(queueName: string, logger: Logger): QueueEvents {
  const queueEvents = new QueueEvents(queueName, { connection: getRedisConnectionOptions() });

  queueEvents.on('failed', ({ jobId, failedReason }) => {
    logger.error(
      { event: 'queue_job_failed', queueName, jobId, failedReason },
      `Job ${jobId} da fila ${queueName} falhou: ${failedReason}`,
    );

    if (process.env.SENTRY_DSN) {
      Sentry.captureMessage(`Job falhou na fila ${queueName}: ${failedReason}`, {
        tags: { queueName, jobId },
        level: 'error',
      });
    }
  });

  queueEvents.on('error', (err) => {
    logger.error(
      { event: 'queue_connection_error', queueName, stack: err.stack },
      `Erro de conexão na fila ${queueName}: ${err.message}`,
    );

    if (process.env.SENTRY_DSN) {
      Sentry.captureException(err, { tags: { queueName } });
    }
  });

  return queueEvents;
}
