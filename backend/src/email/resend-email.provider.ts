import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppError } from '../common/errors/app-error';
import { ErrorCategory } from '../common/errors/error-category.enum';
import { EmailProvider, SendEmailParams } from './email-provider.interface';
import { SmtpVerifyResult } from './smtp-email.provider';

const RESEND_SEND_URL = 'https://api.resend.com/emails';
// Endpoint leve (não envia nada) só pra checar auth/conectividade no
// `GET /health/smtp` sem gastar cota de email.
const RESEND_PING_URL = 'https://api.resend.com/domains';

/**
 * Envia email via API HTTP do Resend (porta 443) em vez de SMTP (porta
 * 587). Motivo: `GET /health/smtp` mostrou `ETIMEDOUT` conectando em
 * smtp.resend.com:587 a partir do Railway — bloqueio/instabilidade de
 * saída em porta SMTP, comum em PaaS. HTTPS de saída não tem esse
 * problema (mesma rota que qualquer outra chamada de API do sistema, ex.
 * Mercado Pago).
 *
 * Resend usa a mesma API key tanto pra SMTP (como senha) quanto pra API
 * HTTP (como Bearer token) — por isso, se `RESEND_API_KEY` não estiver
 * setada mas `SMTP_HOST` apontar pro Resend, reaproveita `SMTP_PASSWORD`
 * como API key. Isso evita ter que configurar mais uma env var no Railway
 * só pra trocar o transporte.
 */
@Injectable()
export class ResendEmailProvider implements EmailProvider {
  private readonly apiKey: string | undefined;
  private readonly from: string;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {
    const smtpHost = this.config.get<string>('SMTP_HOST');
    this.apiKey =
      this.config.get<string>('RESEND_API_KEY') ||
      (smtpHost?.includes('resend.com') ? this.config.get<string>('SMTP_PASSWORD') : undefined);

    const user = this.config.get<string>('SMTP_USER');
    this.from = this.config.get<string>('SMTP_FROM') || user || 'no-reply@zabot.app';
  }

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  async send(params: SendEmailParams): Promise<void> {
    if (!this.apiKey) {
      throw new AppError('Resend API key não configurada', ErrorCategory.REDE, { to: params.to });
    }

    let response: Response;
    try {
      response = await fetch(RESEND_SEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: params.to,
          subject: params.subject,
          text: params.text,
          html: params.html,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      // Falha de rede/timeout na própria chamada HTTPS (rara — diferente do
      // ETIMEDOUT de SMTP que motivou esta troca de transporte).
      throw new AppError(
        'Falha ao enviar email via Resend (rede)',
        ErrorCategory.REDE,
        { to: params.to, subject: params.subject },
        err,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new AppError('Falha ao enviar email via Resend', ErrorCategory.REDE, {
        to: params.to,
        subject: params.subject,
        status: response.status,
        body,
      });
    }
  }

  /**
   * Diagnóstico consumido por `GET /health/smtp` (`HealthController`) —
   * mesmo formato de retorno do `SmtpEmailProvider.verify()` pra não exigir
   * mudança no controller/consumidor além de qual provider é chamado.
   */
  async verify(): Promise<SmtpVerifyResult> {
    if (!this.apiKey) {
      return { configured: false, ok: false };
    }

    try {
      const response = await fetch(RESEND_PING_URL, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) {
        return { configured: true, ok: true };
      }
      const body = await response.text().catch(() => '');
      return {
        configured: true,
        ok: false,
        responseCode: response.status,
        message: body || `HTTP ${response.status}`,
      };
    } catch (err) {
      const code = (err as { code?: string; name?: string } | undefined)?.code;
      const message = err instanceof Error ? err.message : String(err);
      return { configured: true, ok: false, code, message };
    }
  }
}
