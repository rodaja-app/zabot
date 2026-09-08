import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Logger } from 'nestjs-pino';
import * as Sentry from '@sentry/node';
import { categorizeError } from '../errors/error-categorizer';

/**
 * Único ponto de captura de erro de toda a API (`@Catch()` sem argumento
 * pega literalmente qualquer coisa lançada em qualquer rota — controller,
 * pipe, guard). Registrado uma vez em main.ts; nenhuma rota precisa do
 * próprio try/catch pra ter log estruturado com motivo.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { category, message, statusCode, details } = categorizeError(exception);

    this.logger.error(
      {
        category,
        details,
        path: request?.url,
        method: request?.method,
        stack: exception instanceof Error ? exception.stack : undefined,
      },
      message,
    );

    if (process.env.SENTRY_DSN && statusCode >= 500) {
      Sentry.captureException(exception, { tags: { category } });
    }

    response.status(statusCode).json({
      statusCode,
      category,
      message,
      timestamp: new Date().toISOString(),
      path: request?.url,
    });
  }
}
