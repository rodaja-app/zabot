export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface SendEmailParams {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Abstração de envio de email — mesmo padrão arquitetural do
 * `WhatsAppProvider` descrito no README (seção 1/12): a lógica de negócio
 * nunca fala com SMTP diretamente, só com esta interface. Trocar de
 * provedor no futuro (ex.: SES, Resend, Postmark) não exige tocar em nenhum
 * outro módulo — só a implementação (`EmailProvider`) escolhida em
 * `email.module.ts`.
 */
export interface EmailProvider {
  send(params: SendEmailParams): Promise<void>;
}
