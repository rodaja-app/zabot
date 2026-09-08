import { Injectable } from '@nestjs/common';
import { EmailProvider, SendEmailParams } from '../../src/email/email-provider.interface';

/**
 * Substitui `LogEmailProvider`/`SmtpEmailProvider` nos testes e2e (override
 * do token `EMAIL_PROVIDER`, ver `utils/e2e-app.ts`) — captura os emails em
 * memória em vez de logar/enviar de verdade, para `auth.e2e-spec.ts`
 * conseguir extrair o código de verificação de 6 dígitos que
 * `AuthEmailService.sendVerificationCode` embute no `text`
 * (`Seu código de verificação é ${code}. ...`, ver auth-email.service.ts)
 * sem precisar recalcular o hash sha256 (`VerificationCodeService`) — o
 * teste lê o código em texto puro, exatamente como um usuário leria no
 * próprio email.
 */
@Injectable()
export class TestEmailProvider implements EmailProvider {
  readonly sent: SendEmailParams[] = [];

  async send(params: SendEmailParams): Promise<void> {
    this.sent.push(params);
  }

  /** Último email enviado para `to`, ou `undefined` se nenhum foi capturado ainda. */
  lastSentTo(to: string): SendEmailParams | undefined {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      if (this.sent[i].to === to) return this.sent[i];
    }
    return undefined;
  }

  /** Extrai o código de 6 dígitos do último email de verificação enviado para `to`. Lança se não encontrar. */
  lastVerificationCodeFor(to: string): string {
    const email = this.lastSentTo(to);
    if (!email) {
      throw new Error(`Nenhum email capturado para ${to} — TestEmailProvider.sent está vazio para este destinatário.`);
    }
    const match = email.text.match(/(\d{6})/);
    if (!match) {
      throw new Error(`Não foi possível extrair um código de 6 dígitos do email capturado para ${to}: "${email.text}"`);
    }
    return match[1];
  }

  reset(): void {
    this.sent.length = 0;
  }
}
