import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Logger } from 'nestjs-pino';
import { PixPaymentError } from '../common/errors/app-error';

const PAYMENTS_URL = 'https://api.mercadopago.com/v1/payments';

export interface CreatePixPaymentInput {
  idempotencyKey: string;
  transactionAmountCents: number;
  description: string;
  payerEmail: string;
  externalReference: string;
}

export interface PixPaymentResult {
  paymentId: string;
  status: string;
  qrCode?: string;
  qrCodeBase64?: string;
}

export interface CreateCardPaymentInput {
  idempotencyKey: string;
  transactionAmountCents: number;
  description: string;
  payerEmail: string;
  payerCpf: string;
  /** Token de cartão gerado no app via `POST /v1/card_tokens` (nunca dados de cartão em texto puro chegam aqui). */
  cardToken: string;
  /** Ex.: `visa`, `master`, `amex`, `elo`, `hipercard` — detectado no app a partir do BIN. */
  paymentMethodId: string;
  externalReference: string;
}

export interface CardPaymentResult {
  paymentId: string;
  status: string;
  /** Motivo detalhado quando `status = 'rejected'` (ex.: `cc_rejected_insufficient_amount`) — Mercado Pago documenta os códigos comuns. */
  statusDetail?: string;
}

export interface WebhookSignature {
  /** Header `x-signature`, formato `ts=<epoch>,v1=<hex hmac>`. */
  signatureHeader: string | undefined;
  /** Header `x-request-id`. */
  requestId: string | undefined;
  /** `data.id` do corpo/query da notificação — id do pagamento no Mercado Pago. */
  dataId: string | undefined;
}

/**
 * Cliente HTTP para a API de pagamentos do Mercado Pago (Pix) — só 2
 * responsabilidades: criar a cobrança Pix (`POST /v1/payments`) e validar a
 * assinatura do webhook de notificação. Usa `fetch` global (Node 18+, já
 * usado no runtime desta API) em vez de adicionar uma dependência HTTP nova
 * para um único endpoint — mesmo raciocínio que já valeu para o antigo
 * `RevenueCatApiService` (removido junto com o modelo de assinatura).
 *
 * Sem `MERCADOPAGO_ACCESS_TOKEN` configurado, `createPixPayment` falha com
 * `PixPaymentError` (causa clara, nunca undefined silencioso) — suficiente
 * para dev local sem conta Mercado Pago.
 */
@Injectable()
export class MercadoPagoApiService {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {}

  get isEnabled(): boolean {
    return Boolean(this.config.get<string>('MERCADOPAGO_ACCESS_TOKEN'));
  }

  /**
   * Chave pública do Mercado Pago — não é segredo (é feita pra rodar no
   * cliente, usada só pra tokenizar cartão via `/v1/card_tokens`), mas ainda
   * assim nunca é escrita num arquivo versionado (nem `.env.example`): o app
   * busca via `GET /wallet/mercadopago-public-key` em vez de embutir o valor
   * real no código-fonte.
   */
  get publicKey(): string | null {
    return this.config.get<string>('MERCADOPAGO_PUBLIC_KEY') ?? null;
  }

  async createPixPayment(input: CreatePixPaymentInput): Promise<PixPaymentResult> {
    const accessToken = this.config.get<string>('MERCADOPAGO_ACCESS_TOKEN');
    if (!accessToken) {
      throw new PixPaymentError('Mercado Pago não está configurado neste ambiente (MERCADOPAGO_ACCESS_TOKEN ausente).');
    }

    let response: Response;
    try {
      response = await fetch(PAYMENTS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          // Evita duplicar a cobrança em caso de retry de rede do nosso lado
          // (a chamada em si não é idempotente por natureza) — mesmo `id` de
          // recarga (`WalletTransaction.id`) gera sempre a mesma chave.
          'X-Idempotency-Key': input.idempotencyKey,
        },
        body: JSON.stringify({
          transaction_amount: input.transactionAmountCents / 100,
          description: input.description,
          payment_method_id: 'pix',
          external_reference: input.externalReference,
          payer: { email: input.payerEmail },
        }),
      });
    } catch (err) {
      this.logger.error({ event: 'mercadopago_request_error', err }, 'Falha de rede ao criar cobrança Pix no Mercado Pago');
      throw new PixPaymentError('Falha de rede ao criar cobrança Pix.', undefined, err);
    }

    const body = (await response.json().catch(() => undefined)) as Record<string, unknown> | undefined;

    if (!response.ok || !body) {
      this.logger.error(
        { event: 'mercadopago_create_payment_error', status: response.status, body },
        'Mercado Pago recusou a criação da cobrança Pix',
      );
      throw new PixPaymentError('Mercado Pago recusou a criação da cobrança Pix.', { status: response.status, body });
    }

    const pointOfInteraction = body.point_of_interaction as
      | { transaction_data?: { qr_code?: string; qr_code_base64?: string } }
      | undefined;

    return {
      paymentId: String(body.id),
      status: String(body.status),
      qrCode: pointOfInteraction?.transaction_data?.qr_code,
      qrCodeBase64: pointOfInteraction?.transaction_data?.qr_code_base64,
    };
  }

  /**
   * Cria a cobrança de cartão de crédito — mesma rota `POST /v1/payments` da
   * Pix, só que com `token`/`payment_method_id`/`installments` em vez de
   * `payment_method_id: 'pix'`. Diferença importante: cartão responde de
   * forma SÍNCRONA (`approved`/`rejected`/`in_process` já vêm nesta mesma
   * chamada), então `WalletService` credita o saldo direto na resposta em
   * vez de depender só do webhook (que ainda assim pode chegar depois, e é
   * idempotente — ver `applyPaymentUpdate`). Sempre `installments: 1` (à
   * vista) — decisão de escopo, sem parcelamento por enquanto.
   */
  async createCardPayment(input: CreateCardPaymentInput): Promise<CardPaymentResult> {
    const accessToken = this.config.get<string>('MERCADOPAGO_ACCESS_TOKEN');
    if (!accessToken) {
      throw new PixPaymentError('Mercado Pago não está configurado neste ambiente (MERCADOPAGO_ACCESS_TOKEN ausente).');
    }

    let response: Response;
    try {
      response = await fetch(PAYMENTS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'X-Idempotency-Key': input.idempotencyKey,
        },
        body: JSON.stringify({
          transaction_amount: input.transactionAmountCents / 100,
          token: input.cardToken,
          description: input.description,
          installments: 1,
          payment_method_id: input.paymentMethodId,
          external_reference: input.externalReference,
          payer: {
            email: input.payerEmail,
            identification: { type: 'CPF', number: input.payerCpf },
          },
        }),
      });
    } catch (err) {
      this.logger.error({ event: 'mercadopago_card_request_error', err }, 'Falha de rede ao criar cobrança de cartão no Mercado Pago');
      throw new PixPaymentError('Falha de rede ao criar cobrança de cartão.', undefined, err);
    }

    const body = (await response.json().catch(() => undefined)) as Record<string, unknown> | undefined;

    if (!response.ok || !body) {
      this.logger.error(
        { event: 'mercadopago_create_card_payment_error', status: response.status, body },
        'Mercado Pago recusou a criação da cobrança de cartão',
      );
      throw new PixPaymentError('Mercado Pago recusou a criação da cobrança de cartão.', { status: response.status, body });
    }

    return {
      paymentId: String(body.id),
      status: String(body.status),
      statusDetail: typeof body.status_detail === 'string' ? body.status_detail : undefined,
    };
  }

  /**
   * Notificação de webhook do Mercado Pago só traz `data.id` (o id do
   * pagamento) — o resto (status, `external_reference`) precisa ser
   * buscado de volta na API deles antes de creditar qualquer coisa, nunca
   * confiar em campos soltos do corpo da notificação em si (recomendação
   * oficial do Mercado Pago: notificação é só um "avise-se", não a fonte de
   * verdade do pagamento).
   */
  async getPayment(paymentId: string): Promise<{ id: string; status: string; externalReference: string | null }> {
    const accessToken = this.config.get<string>('MERCADOPAGO_ACCESS_TOKEN');
    if (!accessToken) {
      throw new PixPaymentError('Mercado Pago não está configurado neste ambiente (MERCADOPAGO_ACCESS_TOKEN ausente).');
    }

    let response: Response;
    try {
      response = await fetch(`${PAYMENTS_URL}/${encodeURIComponent(paymentId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (err) {
      this.logger.error({ event: 'mercadopago_get_payment_network_error', paymentId, err }, 'Falha de rede ao consultar pagamento Pix no Mercado Pago');
      throw new PixPaymentError('Falha de rede ao consultar pagamento Pix.', { paymentId }, err);
    }

    const body = (await response.json().catch(() => undefined)) as Record<string, unknown> | undefined;
    if (!response.ok || !body) {
      this.logger.error(
        { event: 'mercadopago_get_payment_error', paymentId, status: response.status, body },
        'Mercado Pago recusou a consulta do pagamento Pix',
      );
      throw new PixPaymentError('Mercado Pago recusou a consulta do pagamento Pix.', { paymentId, status: response.status });
    }

    return {
      id: String(body.id),
      status: String(body.status),
      externalReference: typeof body.external_reference === 'string' ? body.external_reference : null,
    };
  }

  /**
   * Verifica o header `x-signature` de uma notificação de webhook —
   * manifesto `id:{dataId};request-id:{requestId};ts:{ts};` assinado com
   * HMAC-SHA256 usando `MERCADOPAGO_WEBHOOK_SECRET` (ver
   * https://www.mercadopago.com.br/developers, "Webhooks > Assinatura").
   *
   * Sem `MERCADOPAGO_WEBHOOK_SECRET` configurado, aceita qualquer
   * notificação sem checar assinatura — permissivo só para dev local sem
   * domínio público para cadastrar o webhook de verdade (mesmo padrão do
   * antigo `REVENUECAT_WEBHOOK_HMAC_SECRET`); loga um warn para não passar
   * despercebido. Em produção, `MERCADOPAGO_WEBHOOK_SECRET` DEVE estar
   * setado, senão qualquer request forjado poderia creditar saldo.
   */
  verifyWebhookSignature(sig: WebhookSignature): boolean {
    const secret = this.config.get<string>('MERCADOPAGO_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.warn(
        { event: 'mercadopago_webhook_signature_skipped' },
        'MERCADOPAGO_WEBHOOK_SECRET ausente — assinatura do webhook Mercado Pago não verificada (aceitando sem checar)',
      );
      return true;
    }

    if (!sig.signatureHeader || !sig.dataId) return false;

    const parts = new Map<string, string>();
    for (const segment of sig.signatureHeader.split(',')) {
      const [key, value] = segment.split('=').map((part) => part.trim());
      if (key && value) parts.set(key, value);
    }
    const ts = parts.get('ts');
    const receivedHash = parts.get('v1');
    if (!ts || !receivedHash) return false;

    const manifest = `id:${sig.dataId};${sig.requestId ? `request-id:${sig.requestId};` : ''}ts:${ts};`;
    const expectedHash = createHmac('sha256', secret).update(manifest).digest('hex');

    const expected = Buffer.from(expectedHash, 'utf8');
    const received = Buffer.from(receivedHash, 'utf8');
    if (expected.length !== received.length) return false;
    return timingSafeEqual(expected, received);
  }
}
