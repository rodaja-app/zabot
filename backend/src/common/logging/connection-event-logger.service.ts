import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import * as Sentry from '@sentry/node';
import { categorizeError } from '../errors/error-categorizer';

/**
 * Ponto único de log para eventos de conexão (sessão WhatsApp/Baileys) e de
 * entrega de mensagem (transições de ACK). Usado pelos módulos de sessão
 * (etapa 11), proxy (etapa 12) e fila/envio (etapa 15) em vez de cada um
 * implementar o próprio log — garante formato consistente e causa real
 * sempre presente, nunca "deu erro" genérico.
 */
@Injectable()
export class ConnectionEventLoggerService {
  constructor(private readonly logger: Logger) {}

  /** Log de transição de estado de conexão de uma sessão (ex.: Baileys `connection.update`). */
  logConnectionEvent(params: {
    sessionId: string;
    state: 'connecting' | 'open' | 'close' | 'reconnecting' | 'logged_out';
    reason?: string;
    proxyHost?: string;
    latencyMs?: number;
  }): void {
    this.logger.log(
      { event: 'connection_state', ...params },
      `Sessão ${params.sessionId}: ${params.state}${params.reason ? ` (${params.reason})` : ''}`,
    );
  }

  /** Log de falha de conexão/proxy com causa categorizada (timeout, auth, IP expirado, recusado, etc.). */
  logConnectionError(params: {
    sessionId: string;
    proxyHost?: string;
    latencyMs?: number;
    exception: unknown;
  }): void {
    const { category, message, details } = categorizeError(params.exception);
    this.logger.error(
      {
        event: 'connection_error',
        sessionId: params.sessionId,
        proxyHost: params.proxyHost,
        latencyMs: params.latencyMs,
        category,
        details,
        stack: params.exception instanceof Error ? params.exception.stack : undefined,
      },
      `Falha de conexão na sessão ${params.sessionId}: ${message}`,
    );

    if (process.env.SENTRY_DSN) {
      Sentry.captureException(params.exception, {
        tags: { category, sessionId: params.sessionId },
      });
    }
  }

  /** Log de cada transição de ACK de uma mensagem enviada (1 servidor / 2 entregue no servidor / 3 entregue no aparelho / 4 lida). */
  logMessageAckTransition(params: {
    sessionId: string;
    campaignId?: string;
    contactId?: string;
    messageId: string;
    ack: number;
    ackLabel: string;
  }): void {
    this.logger.log(
      { event: 'message_ack', ...params },
      `Mensagem ${params.messageId}: ack ${params.ack} (${params.ackLabel})`,
    );
  }

  /** Log de falha de envio de mensagem com causa categorizada. */
  logMessageError(params: {
    sessionId: string;
    campaignId?: string;
    contactId?: string;
    messageId?: string;
    exception: unknown;
  }): void {
    const { category, message, details } = categorizeError(params.exception);
    this.logger.error(
      {
        event: 'message_error',
        ...params,
        category,
        details,
        stack: params.exception instanceof Error ? params.exception.stack : undefined,
      },
      `Falha ao enviar mensagem${params.messageId ? ` ${params.messageId}` : ''}: ${message}`,
    );

    if (process.env.SENTRY_DSN) {
      Sentry.captureException(params.exception, {
        tags: { category, sessionId: params.sessionId, campaignId: params.campaignId },
      });
    }
  }
}
