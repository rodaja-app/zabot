import { Injectable } from '@nestjs/common';
import { CreatePixPaymentInput, PixPaymentResult, WebhookSignature } from '../../src/wallet/mercado-pago-api.service';

/**
 * Substitui `MercadoPagoApiService` nos testes e2e (override de DI, ver
 * `utils/e2e-app.ts`) — mesmo padrão de `FakeWhatsAppProvider`/`TestEmailProvider`.
 * Sem isso, qualquer teste de recarga chamaria a API REAL do Mercado Pago com
 * as credenciais de produção configuradas em `.env` (`MERCADOPAGO_ACCESS_TOKEN`),
 * criando uma cobrança Pix de verdade a cada execução — inaceitável para uma
 * suíte automatizada.
 *
 * Guarda os pagamentos "criados" em memória (`Map`), indexados pelo próprio
 * `paymentId` fake, para que `getPayment` (chamado pelo webhook) devolva o
 * `externalReference` exato que `WalletService.createRecharge` gerou —
 * mesmo contrato da API real, só sem rede.
 */
@Injectable()
export class FakeMercadoPagoApiService {
  private readonly payments = new Map<string, { status: string; externalReference: string }>();
  private counter = 0;
  private lastPaymentId: string | undefined;

  get isEnabled(): boolean {
    return true;
  }

  async createPixPayment(input: CreatePixPaymentInput): Promise<PixPaymentResult> {
    const paymentId = `fake-payment-${++this.counter}`;
    this.payments.set(paymentId, { status: 'pending', externalReference: input.externalReference });
    this.lastPaymentId = paymentId;
    return { paymentId, status: 'pending', qrCode: '00020126-fake-copia-e-cola', qrCodeBase64: 'ZmFrZS1xci1jb2Rl' };
  }

  /** Testes usam isto para pegar o id fake da cobrança que acabaram de criar via `POST /wallet/recharge`, sem precisar expor o Map interno. */
  lastCreatedPaymentId(): string {
    if (!this.lastPaymentId) throw new Error('FakeMercadoPagoApiService: nenhuma cobrança Pix foi criada ainda.');
    return this.lastPaymentId;
  }

  async getPayment(paymentId: string): Promise<{ id: string; status: string; externalReference: string | null }> {
    const stored = this.payments.get(paymentId);
    if (!stored) throw new Error(`FakeMercadoPagoApiService: pagamento ${paymentId} não existe.`);
    return { id: paymentId, status: stored.status, externalReference: stored.externalReference };
  }

  verifyWebhookSignature(_sig: WebhookSignature): boolean {
    return true;
  }

  /** Testes usam isto para simular a confirmação do Pix pelo Mercado Pago antes de disparar o webhook fake. */
  markApproved(paymentId: string): void {
    const stored = this.payments.get(paymentId);
    if (stored) stored.status = 'approved';
  }

  markRejected(paymentId: string): void {
    const stored = this.payments.get(paymentId);
    if (stored) stored.status = 'rejected';
  }

  /** Estado do fake é global ao processo de teste (singleton DI) — limpar entre specs evita vazamento. */
  reset(): void {
    this.payments.clear();
    this.counter = 0;
    this.lastPaymentId = undefined;
  }
}
