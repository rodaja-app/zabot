import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { createTransport, Transporter } from 'nodemailer';
import { AppError } from '../common/errors/app-error';
import { ErrorCategory } from '../common/errors/error-category.enum';
import { EmailProvider, SendEmailParams } from './email-provider.interface';

/**
 * Resultado de `SmtpEmailProvider.verify()` — usado pelo endpoint público
 * `GET /health/smtp` (ver `health.controller.ts`) pra diagnosticar SMTP em
 * produção direto pelo navegador, sem precisar gerar um build do app só
 * pra reproduzir uma falha de cadastro/reenvio de código. Nunca carrega a
 * senha, só host/porta (dado que já vaza em qualquer erro de rede comum) e
 * o motivo cru da falha (code/message do nodemailer).
 */
export interface SmtpVerifyResult {
  configured: boolean;
  ok: boolean;
  host?: string;
  port?: number;
  code?: string;
  responseCode?: number;
  message?: string;
}

@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly host: string | undefined;
  private readonly port: number;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {
    const port = this.config.get<number>('SMTP_PORT') || 587;
    const user = this.config.get<string>('SMTP_USER');

    this.host = this.config.get<string>('SMTP_HOST');
    this.port = port;
    this.from = this.config.get<string>('SMTP_FROM') || user || 'no-reply@zabot.app';
    this.transporter = createTransport({
      host: this.host,
      port,
      secure: port === 465,
      auth: user ? { user, pass: this.config.get<string>('SMTP_PASSWORD') } : undefined,
      // Sem estes três, o nodemailer usa os defaults dele (connectionTimeout
      // de 2min, socketTimeout de 10min) — se o host SMTP estiver
      // inacessível/mal configurado, `sendMail` fica pendurado por minutos e,
      // como `register()`/`resendCode()` aguardam este envio antes de
      // responder o HTTP, o app fica travado em "Carregando..." sem nunca
      // cair no catch de erro (nem timeout nem exceção acontecem a tempo do
      // usuário perceber). Timeouts curtos garantem que uma falha de SMTP
      // vira um erro REDE de verdade em segundos, não minutos.
      connectionTimeout: 8_000,
      greetingTimeout: 8_000,
      socketTimeout: 10_000,
    });
  }

  async send(params: SendEmailParams): Promise<void> {
    try {
      await this.transporter.sendMail({ from: this.from, ...params });
    } catch (err) {
      // Categoria REDE: falha de entrega de email é, na prática, uma falha
      // de conectividade com um serviço externo — mesma lógica de causa
      // real aplicada em qualquer outra chamada de rede do sistema.
      throw new AppError(
        'Falha ao enviar email via SMTP',
        ErrorCategory.REDE,
        { to: params.to, subject: params.subject },
        err,
      );
    }
  }

  /**
   * Testa a conexão/autenticação SMTP real via `transporter.verify()` do
   * nodemailer (handshake + auth, sem enviar nenhum email) — é o que dá
   * pro endpoint `/health/smtp` mostrar o erro cru (ECONNREFUSED, ETIMEDOUT,
   * EAUTH etc.) que hoje só aparecia embrulhado/escondido no log do
   * `AppError` do `send()`.
   */
  async verify(): Promise<SmtpVerifyResult> {
    if (!this.host) {
      return { configured: false, ok: false, host: this.host, port: this.port };
    }

    try {
      await this.transporter.verify();
      return { configured: true, ok: true, host: this.host, port: this.port };
    } catch (err) {
      const code = (err as { code?: string } | undefined)?.code;
      const responseCode = (err as { responseCode?: number } | undefined)?.responseCode;
      const message = err instanceof Error ? err.message : String(err);
      return { configured: true, ok: false, host: this.host, port: this.port, code, responseCode, message };
    }
  }
}
