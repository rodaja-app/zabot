import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { getLogContext } from '../context/request-context.store';
import { ConnectionEventLoggerService } from './connection-event-logger.service';

/**
 * Configuração única do Pino para todo o backend. O `mixin` injeta o
 * contexto atual (requestId, sessionId, campaignId, userId, etc.) vindo do
 * AsyncLocalStorage em TODA linha de log, sem precisar passar esse contexto
 * manualmente em cada chamada de log espalhada pelo código.
 */
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL || 'info',
        mixin() {
          return getLogContext();
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            '*.password',
            '*.senha',
            '*.token',
            '*.accessToken',
            '*.refreshToken',
          ],
          censor: '[REDACTED]',
        },
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { colorize: true, singleLine: true } },
        autoLogging: {
          ignore: (req) => req.url === '/health',
        },
      },
    }),
  ],
  providers: [ConnectionEventLoggerService],
  exports: [LoggerModule, ConnectionEventLoggerService],
})
export class AppLoggingModule {}
