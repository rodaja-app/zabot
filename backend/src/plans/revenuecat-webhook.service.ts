import * as crypto from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { Prisma, PaymentStatus, SubscriptionStatus } from '@prisma/client';
import { RevenueCatWebhookAuthError } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Subconjunto do payload de webhook da RevenueCat que este backend usa (ver
 * https://www.revenuecat.com/docs/webhooks/event-types-and-fields — muitos
 * campos são "Sometimes", por isso quase tudo aqui é opcional). `app_user_id`
 * é o `User.id` deste backend diretamente — o app chama `Purchases.logIn(userId)`
 * com o próprio id do usuário como app_user_id da RevenueCat, então não existe
 * (nem precisa existir) tabela de mapeamento de identidade.
 */
export interface RevenueCatWebhookEvent {
  id: string;
  type: string;
  event_timestamp_ms: number;
  app_id?: string;
  app_user_id: string;
  original_app_user_id?: string;
  product_id?: string;
  period_type?: 'TRIAL' | 'INTRO' | 'NORMAL' | 'PROMOTIONAL' | 'PREPAID';
  purchased_at_ms?: number;
  expiration_at_ms?: number;
  environment?: 'SANDBOX' | 'PRODUCTION';
  entitlement_ids?: string[];
  transaction_id?: string;
  original_transaction_id?: string;
  store?: string;
  currency?: string;
  price?: number;
  cancel_reason?: string;
  expiration_reason?: string;
  new_product_id?: string;
}

export interface RevenueCatWebhookPayload {
  api_version: string;
  event: RevenueCatWebhookEvent;
}

/** Tipos de evento cuja ocorrência representa dinheiro de fato mudando de mãos (ou uma tentativa que falhou) — os únicos que viram `PaymentHistoryEntry` (README raiz "Etapa 16"). */
const FINANCIAL_EVENT_TYPES: Record<string, PaymentStatus> = {
  INITIAL_PURCHASE: PaymentStatus.PAGO,
  RENEWAL: PaymentStatus.PAGO,
  PRODUCT_CHANGE: PaymentStatus.PAGO,
  REFUND_REVERSED: PaymentStatus.PAGO,
  BILLING_ISSUE: PaymentStatus.FALHOU,
};

/** Eventos que colocam (ou mantêm) a assinatura em uso normal — `TRIAL` quando `period_type` do evento é `TRIAL`, `ATIVA` nos demais casos. */
const ACTIVATING_EVENT_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
  'SUBSCRIPTION_EXTENDED',
  'TRANSFER',
  'REFUND_REVERSED',
]);

/**
 * Etapa 16 (Planos e uso — README raiz §16). Processa webhooks da
 * RevenueCat: verifica autenticidade, garante idempotência via
 * `RevenueCatEvent.id` (chave primária — reentrega do mesmo evento vira
 * `P2002`, tratado como no-op) e traduz o evento em atualização de
 * `Subscription`/`PaymentHistoryEntry`.
 *
 * Nunca chama a REST API da RevenueCat (isso é `RevenueCatApiService`, usado
 * só por `PlansService.syncFromRevenueCat`) — o payload do próprio webhook já
 * tem os campos necessários; manter os dois desacoplados evita que
 * processar um webhook fique refém da disponibilidade da API deles.
 */
@Injectable()
export class RevenueCatWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {}

  /**
   * Verificação básica (sempre feita, se `REVENUECAT_WEBHOOK_AUTH_HEADER`
   * estiver configurada — sem ela, deliberadamente permissivo, para dev
   * local sem essa variável setada; ver `.env.example`) + verificação HMAC
   * opcional e mais forte (`REVENUECAT_WEBHOOK_HMAC_SECRET`), calculada
   * SEMPRE sobre os bytes crus do corpo (antes do parse de JSON) — por isso
   * exige `rawBody: true` no bootstrap (`main.ts`) e recebe `rawBody` aqui em
   * vez de reserializar o body já parseado (reserializar poderia produzir
   * bytes diferentes dos originais — ex.: ordem de chaves, espaçamento — e
   * quebrar a assinatura).
   */
  verifyRequest(rawBody: Buffer, headers: { authorization?: string; 'x-revenuecat-webhook-signature'?: string }): void {
    const expectedAuth = this.config.get<string>('REVENUECAT_WEBHOOK_AUTH_HEADER');
    if (expectedAuth) {
      if (headers.authorization !== expectedAuth) {
        throw new RevenueCatWebhookAuthError('Header Authorization do webhook RevenueCat ausente ou incorreto.');
      }
    }

    const hmacSecret = this.config.get<string>('REVENUECAT_WEBHOOK_HMAC_SECRET');
    if (hmacSecret) {
      this.verifyHmacSignature(rawBody, headers['x-revenuecat-webhook-signature'], hmacSecret);
    }
  }

  private verifyHmacSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): void {
    if (!signatureHeader) {
      throw new RevenueCatWebhookAuthError('Header X-RevenueCat-Webhook-Signature ausente (HMAC habilitado via REVENUECAT_WEBHOOK_HMAC_SECRET).');
    }

    const parts = Object.fromEntries(
      signatureHeader.split(',').map((pair) => {
        const [key, value] = pair.split('=');
        return [key, value];
      }),
    );
    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature) {
      throw new RevenueCatWebhookAuthError('Formato inválido do header X-RevenueCat-Webhook-Signature (esperado "t=<ts>,v1=<hex>").');
    }

    const toleranceMs = 5 * 60 * 1000;
    const age = Date.now() - Number(timestamp) * 1000;
    if (!Number.isFinite(age) || Math.abs(age) > toleranceMs) {
      throw new RevenueCatWebhookAuthError('Timestamp do webhook RevenueCat fora da tolerância (possível replay).', { timestamp });
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex');

    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(signature, 'hex');
    if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
      throw new RevenueCatWebhookAuthError('Assinatura HMAC do webhook RevenueCat inválida.');
    }
  }

  /**
   * Chamado pelo controller depois de `verifyRequest` passar. Nunca lança
   * por "evento de tipo desconhecido" ou "produto não encontrado no
   * catálogo" — só loga um warning e segue (a RevenueCat reentrega em caso
   * de erro 5xx; um evento que este backend não sabe interpretar hoje não
   * deveria virar retry infinito).
   */
  async processEvent(payload: RevenueCatWebhookPayload): Promise<void> {
    const { event } = payload;

    const isNewEvent = await this.recordEventOnce(event);
    if (!isNewEvent) {
      this.logger.log({ event: 'revenuecat_webhook_duplicate', eventId: event.id, type: event.type }, 'Webhook RevenueCat reentregue — ignorado (idempotência).');
      return;
    }

    if (event.type === 'TEST') {
      this.logger.log({ event: 'revenuecat_webhook_test', eventId: event.id }, 'Evento de teste da RevenueCat recebido.');
      return;
    }

    if (!event.app_user_id) {
      this.logger.warn({ event: 'revenuecat_webhook_no_app_user_id', eventId: event.id, type: event.type }, 'Webhook RevenueCat sem app_user_id — não é possível atribuir a um usuário.');
      return;
    }

    try {
      await this.prisma.withTenantContext(event.app_user_id, (tx) => this.applyEvent(tx, event));
    } catch (err) {
      const prismaCode = (err as { code?: string } | undefined)?.code;
      if (prismaCode === 'P2003' || prismaCode === 'P2025') {
        // FK para User inexistente — app_user_id não corresponde a nenhum
        // usuário deste backend (ex.: teste manual no dashboard com um id
        // qualquer). Não é erro transitório — não faz sentido a RevenueCat
        // reentregar, então não relança.
        this.logger.warn(
          { event: 'revenuecat_webhook_unknown_app_user_id', eventId: event.id, appUserId: event.app_user_id },
          'app_user_id do webhook RevenueCat não corresponde a nenhum usuário.',
        );
        return;
      }
      throw err;
    }
  }

  /** `true` se este era um evento novo (registrado agora); `false` se já tinha sido processado (reentrega). */
  private async recordEventOnce(event: RevenueCatWebhookEvent): Promise<boolean> {
    try {
      await this.prisma.revenueCatEvent.create({
        data: { id: event.id, type: event.type, appUserId: event.app_user_id ?? null, payload: event as unknown as Prisma.InputJsonValue },
      });
      return true;
    } catch (err) {
      if ((err as { code?: string } | undefined)?.code === 'P2002') return false;
      throw err;
    }
  }

  private async applyEvent(tx: Prisma.TransactionClient, event: RevenueCatWebhookEvent): Promise<void> {
    const plan = event.product_id
      ? await tx.plan.findUnique({ where: { revenueCatProductId: event.product_id } })
      : null;
    if (event.product_id && !plan) {
      this.logger.warn(
        { event: 'revenuecat_webhook_unknown_product', eventId: event.id, productId: event.product_id },
        'product_id do webhook RevenueCat não corresponde a nenhum Plan do catálogo (seed desatualizado?).',
      );
    }

    await this.upsertSubscription(tx, event, plan?.id);
    await this.recordPaymentHistoryIfApplicable(tx, event, plan?.id);
  }

  private async upsertSubscription(tx: Prisma.TransactionClient, event: RevenueCatWebhookEvent, planId: string | undefined): Promise<void> {
    const patch = this.buildSubscriptionPatch(event, planId);

    await tx.subscription.upsert({
      where: { userId: event.app_user_id },
      update: patch,
      create: {
        userId: event.app_user_id,
        planId: planId ?? null,
        status: patch.status ?? SubscriptionStatus.EXPIRADA,
        autoRenew: patch.autoRenew ?? true,
        currentPeriodStart: patch.currentPeriodStart,
        currentPeriodEnd: patch.currentPeriodEnd,
        store: event.store,
        environment: event.environment,
        originalTransactionId: event.original_transaction_id,
        lastEventType: event.type,
        lastEventAt: new Date(event.event_timestamp_ms),
      },
    });
  }

  /**
   * Traduz 1 evento em um patch parcial de `Subscription` — deliberadamente
   * NÃO mexe em `status`/`autoRenew` para tipos de evento que não implicam
   * mudança de estado de uso (ex.: `BILLING_ISSUE` sozinho não expira a
   * assinatura; a RevenueCat manda `EXPIRATION` separadamente se o problema
   * de cobrança não se resolver dentro do período de graça da loja).
   */
  private buildSubscriptionPatch(event: RevenueCatWebhookEvent, planId: string | undefined): Prisma.SubscriptionUpdateInput {
    const patch: Prisma.SubscriptionUpdateInput = {
      lastEventType: event.type,
      lastEventAt: new Date(event.event_timestamp_ms),
      store: event.store,
      environment: event.environment,
      originalTransactionId: event.original_transaction_id,
    };
    if (planId) patch.plan = { connect: { id: planId } };
    if (event.purchased_at_ms) patch.currentPeriodStart = new Date(event.purchased_at_ms);
    if (event.expiration_at_ms) patch.currentPeriodEnd = new Date(event.expiration_at_ms);

    if (ACTIVATING_EVENT_TYPES.has(event.type)) {
      patch.status = event.period_type === 'TRIAL' ? SubscriptionStatus.TRIAL : SubscriptionStatus.ATIVA;
      patch.autoRenew = true;
    } else if (event.type === 'CANCELLATION') {
      // Usuário desligou a renovação automática — continua ATIVA/TRIAL até
      // `currentPeriodEnd` (a própria loja só efetiva no fim do período já
      // pago); a RevenueCat manda EXPIRATION separadamente quando esse
      // período realmente terminar sem renovar.
      patch.autoRenew = false;
    } else if (event.type === 'EXPIRATION') {
      patch.status = SubscriptionStatus.EXPIRADA;
      patch.autoRenew = false;
    }

    return patch;
  }

  private async recordPaymentHistoryIfApplicable(tx: Prisma.TransactionClient, event: RevenueCatWebhookEvent, planId: string | undefined): Promise<void> {
    const status = FINANCIAL_EVENT_TYPES[event.type];
    if (!status) return;

    try {
      await tx.paymentHistoryEntry.create({
        data: {
          userId: event.app_user_id,
          planId: planId ?? null,
          eventType: event.type,
          status,
          amountCents: typeof event.price === 'number' ? Math.round(event.price * 100) : null,
          currency: event.currency ?? null,
          occurredAt: new Date(event.event_timestamp_ms),
          revenueCatEventId: event.id,
        },
      });
    } catch (err) {
      // revenueCatEventId é único — só deveria colidir se este evento já
      // tivesse passado por aqui (não deveria acontecer, já que `recordEventOnce`
      // barra reentregas antes de chegar até aqui, mas mantém a garantia).
      if ((err as { code?: string } | undefined)?.code !== 'P2002') throw err;
    }
  }
}
