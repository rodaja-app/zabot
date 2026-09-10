import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EMAIL_PROVIDER } from './email-provider.interface';
import { LogEmailProvider } from './log-email.provider';
import { ResendEmailProvider } from './resend-email.provider';
import { SmtpEmailProvider } from './smtp-email.provider';

/**
 * Escolhe o provedor real entre Resend (API HTTP), SMTP e log-only, nessa
 * ordem de prioridade — troca de implementação inteiramente por injeção de
 * dependência, sem `if` nenhum espalhado pelo resto do código (mesmo padrão
 * do `WhatsAppProvider` planejado para a etapa 11).
 *
 * Resend vem primeiro porque `GET /health/smtp` mostrou `ETIMEDOUT` do
 * Railway pra smtp.resend.com:587 — a API HTTP do Resend usa a mesma
 * `SMTP_PASSWORD` como Bearer token (ver `resend-email.provider.ts`), então
 * assim que o SMTP_HOST configurado aponta pro Resend, o app já passa a
 * enviar por HTTPS automaticamente, sem precisar mexer em env var no
 * Railway.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    LogEmailProvider,
    SmtpEmailProvider,
    ResendEmailProvider,
    {
      provide: EMAIL_PROVIDER,
      useFactory: (
        config: ConfigService,
        resend: ResendEmailProvider,
        smtp: SmtpEmailProvider,
        log: LogEmailProvider,
      ) => (resend.configured ? resend : config.get<string>('SMTP_HOST') ? smtp : log),
      inject: [ConfigService, ResendEmailProvider, SmtpEmailProvider, LogEmailProvider],
    },
  ],
  // `SmtpEmailProvider`/`ResendEmailProvider` exportados separadamente (além
  // do token `EMAIL_PROVIDER`) pra `HealthController` poder injetá-los direto
  // e expor `GET /health/smtp` — diagnóstico real independente de qual dos
  // dois está ativo como `EMAIL_PROVIDER`.
  exports: [EMAIL_PROVIDER, SmtpEmailProvider, ResendEmailProvider],
})
export class EmailModule {}
