import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { createTransport, Transporter } from 'nodemailer';
import { AppError } from '../common/errors/app-error';
import { ErrorCategory } from '../common/errors/error-category.enum';
import { EmailProvider, SendEmailParams } from './email-provider.interface';

@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {
    const port = this.config.get<number>('SMTP_PORT') || 587;
    const user = this.config.get<string>('SMTP_USER');

    this.from = this.config.get<string>('SMTP_FROM') || user || 'no-reply@zabot.app';
    this.transporter = createTransport({
      host: this.config.get<string>('SMTP_HOST'),
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
}
