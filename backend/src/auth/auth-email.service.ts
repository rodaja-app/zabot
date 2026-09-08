import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_PROVIDER, EmailProvider } from '../email/email-provider.interface';

/**
 * Templates de email específicos do fluxo de autenticação. Fica no módulo
 * Auth (não em email/) porque o conteúdo é regra de negócio do Auth; a
 * capacidade genérica de "enviar email" é que é infraestrutura reutilizável
 * (EmailModule/EmailProvider).
 */
@Injectable()
export class AuthEmailService {
  constructor(@Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider) {}

  async sendVerificationCode(to: string, code: string, ttlMinutes: number): Promise<void> {
    await this.emailProvider.send({
      to,
      subject: 'Seu código de verificação ZaBot',
      text: `Seu código de verificação é ${code}. Ele expira em ${ttlMinutes} minutos.`,
      html: `<p>Seu código de verificação é <strong>${code}</strong>.</p><p>Ele expira em ${ttlMinutes} minutos.</p>`,
    });
  }
}
