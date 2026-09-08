import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { EmailProvider, SendEmailParams } from './email-provider.interface';

/**
 * Provedor de fallback usado quando SMTP_HOST não está configurado (dev
 * local sem servidor de email disponível). Loga o conteúdo do email em vez
 * de enviar de verdade — deixa claro no log que nada foi entregue de fato,
 * em vez de fingir sucesso silenciosamente.
 */
@Injectable()
export class LogEmailProvider implements EmailProvider {
  constructor(private readonly logger: Logger) {}

  async send(params: SendEmailParams): Promise<void> {
    this.logger.warn(
      { event: 'email_log_only', to: params.to, subject: params.subject, body: params.text },
      'SMTP não configurado — email não enviado de verdade, só logado (LogEmailProvider)',
    );
  }
}
