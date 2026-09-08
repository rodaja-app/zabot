import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EMAIL_PROVIDER } from './email-provider.interface';
import { LogEmailProvider } from './log-email.provider';
import { SmtpEmailProvider } from './smtp-email.provider';

/**
 * Escolhe o provedor real (SMTP) quando SMTP_HOST está configurado, e cai
 * para o provedor log-only caso contrário — troca de implementação
 * inteiramente por injeção de dependência, sem `if` nenhum espalhado pelo
 * resto do código (mesmo padrão do `WhatsAppProvider` planejado para a
 * etapa 11).
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    LogEmailProvider,
    SmtpEmailProvider,
    {
      provide: EMAIL_PROVIDER,
      useFactory: (config: ConfigService, smtp: SmtpEmailProvider, log: LogEmailProvider) =>
        config.get<string>('SMTP_HOST') ? smtp : log,
      inject: [ConfigService, SmtpEmailProvider, LogEmailProvider],
    },
  ],
  exports: [EMAIL_PROVIDER],
})
export class EmailModule {}
