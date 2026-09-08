import * as crypto from 'node:crypto';
import { RevenueCatWebhookAuthError } from '../common/errors/app-error';
import { RevenueCatWebhookEvent, RevenueCatWebhookService } from './revenuecat-webhook.service';

/**
 * Testes unitários com Prisma mockado. Cobrem: verificação de Authorization
 * simples, verificação HMAC (tolerância de timestamp + assinatura inválida),
 * idempotência via `RevenueCatEvent.id` (P2002 = no-op), mapeamento de tipo
 * de evento para `Subscription.status`, criação de `PaymentHistoryEntry` só
 * para tipos financeiros, e o tratamento silencioso de app_user_id
 * desconhecido (P2003/P2025).
 */
describe('RevenueCatWebhookService', () => {
  function buildService(env: Record<string, string | undefined> = {}) {
    const txPlan = { findUnique: jest.fn(async () => null as { id: string } | null) };
    const txSubscription = { upsert: jest.fn(async () => ({})) };
    const txPaymentHistoryEntry = { create: jest.fn(async () => ({})) };
    const tx = { plan: txPlan, subscription: txSubscription, paymentHistoryEntry: txPaymentHistoryEntry };

    const revenueCatEvent = { create: jest.fn(async () => ({})) };
    const prisma = {
      revenueCatEvent,
      withTenantContext: jest.fn((_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
    };
    const config = { get: jest.fn((key: string) => env[key]) };
    const logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn(), debug: jest.fn() };

    const service = new RevenueCatWebhookService(prisma as never, config as never, logger as never);
    return { service, prisma, tx, txPlan, txSubscription, txPaymentHistoryEntry, revenueCatEvent, logger };
  }

  function buildEvent(overrides: Partial<RevenueCatWebhookEvent> = {}): RevenueCatWebhookEvent {
    return {
      id: 'evt-1',
      type: 'INITIAL_PURCHASE',
      event_timestamp_ms: Date.parse('2026-01-01T00:00:00.000Z'),
      app_user_id: 'user-1',
      ...overrides,
    };
  }

  describe('verifyRequest — Authorization', () => {
    it('permite quando REVENUECAT_WEBHOOK_AUTH_HEADER não está configurada', () => {
      const { service } = buildService({});
      expect(() => service.verifyRequest(Buffer.from('{}'), {})).not.toThrow();
    });

    it('rejeita quando o header Authorization está ausente ou incorreto', () => {
      const { service } = buildService({ REVENUECAT_WEBHOOK_AUTH_HEADER: 'Bearer secret' });
      expect(() => service.verifyRequest(Buffer.from('{}'), {})).toThrow(RevenueCatWebhookAuthError);
      expect(() => service.verifyRequest(Buffer.from('{}'), { authorization: 'Bearer wrong' })).toThrow(
        RevenueCatWebhookAuthError,
      );
    });

    it('aceita quando o header Authorization confere', () => {
      const { service } = buildService({ REVENUECAT_WEBHOOK_AUTH_HEADER: 'Bearer secret' });
      expect(() => service.verifyRequest(Buffer.from('{}'), { authorization: 'Bearer secret' })).not.toThrow();
    });
  });

  describe('verifyRequest — HMAC', () => {
    const secret = 'hmac-secret';

    function sign(rawBody: Buffer, timestamp: number): string {
      const digest = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex');
      return `t=${timestamp},v1=${digest}`;
    }

    it('rejeita quando o header de assinatura está ausente', () => {
      const { service } = buildService({ REVENUECAT_WEBHOOK_HMAC_SECRET: secret });
      expect(() => service.verifyRequest(Buffer.from('{}'), {})).toThrow(RevenueCatWebhookAuthError);
    });

    it('rejeita formato inválido do header (sem t= ou v1=)', () => {
      const { service } = buildService({ REVENUECAT_WEBHOOK_HMAC_SECRET: secret });
      expect(() =>
        service.verifyRequest(Buffer.from('{}'), { 'x-revenuecat-webhook-signature': 'garbage' }),
      ).toThrow(RevenueCatWebhookAuthError);
    });

    it('rejeita quando o timestamp está fora da tolerância de 5 minutos', () => {
      const { service } = buildService({ REVENUECAT_WEBHOOK_HMAC_SECRET: secret });
      const rawBody = Buffer.from('{"a":1}');
      const staleTimestamp = Math.floor(Date.now() / 1000) - 10 * 60;
      const header = sign(rawBody, staleTimestamp);

      expect(() =>
        service.verifyRequest(rawBody, { 'x-revenuecat-webhook-signature': header }),
      ).toThrow(RevenueCatWebhookAuthError);
    });

    it('rejeita quando a assinatura não confere', () => {
      const { service } = buildService({ REVENUECAT_WEBHOOK_HMAC_SECRET: secret });
      const rawBody = Buffer.from('{"a":1}');
      const timestamp = Math.floor(Date.now() / 1000);
      expect(() =>
        service.verifyRequest(rawBody, { 'x-revenuecat-webhook-signature': `t=${timestamp},v1=${'0'.repeat(64)}` }),
      ).toThrow(RevenueCatWebhookAuthError);
    });

    it('aceita quando timestamp está dentro da tolerância e a assinatura confere', () => {
      const { service } = buildService({ REVENUECAT_WEBHOOK_HMAC_SECRET: secret });
      const rawBody = Buffer.from('{"a":1}');
      const timestamp = Math.floor(Date.now() / 1000);
      const header = sign(rawBody, timestamp);

      expect(() => service.verifyRequest(rawBody, { 'x-revenuecat-webhook-signature': header })).not.toThrow();
    });
  });

  describe('processEvent — idempotência', () => {
    it('ignora silenciosamente (sem tocar subscription) quando o evento já foi processado (P2002)', async () => {
      const { service, revenueCatEvent, prisma } = buildService();
      revenueCatEvent.create.mockRejectedValue({ code: 'P2002' });

      await service.processEvent({ api_version: '1.0', event: buildEvent() });

      expect(prisma.withTenantContext).not.toHaveBeenCalled();
    });

    it('relança erros inesperados do registro do evento', async () => {
      const { service, revenueCatEvent } = buildService();
      revenueCatEvent.create.mockRejectedValue(new Error('db down'));

      await expect(service.processEvent({ api_version: '1.0', event: buildEvent() })).rejects.toThrow('db down');
    });
  });

  describe('processEvent — casos especiais', () => {
    it('evento TEST não toca subscription', async () => {
      const { service, prisma } = buildService();
      await service.processEvent({ api_version: '1.0', event: buildEvent({ type: 'TEST' }) });
      expect(prisma.withTenantContext).not.toHaveBeenCalled();
    });

    it('evento sem app_user_id não toca subscription', async () => {
      const { service, prisma } = buildService();
      await service.processEvent({ api_version: '1.0', event: buildEvent({ app_user_id: '' }) });
      expect(prisma.withTenantContext).not.toHaveBeenCalled();
    });

    it('app_user_id desconhecido (P2003/P2025) é tratado silenciosamente', async () => {
      const { service, tx } = buildService();
      (tx.subscription.upsert as jest.Mock).mockRejectedValue({ code: 'P2003' });

      await expect(service.processEvent({ api_version: '1.0', event: buildEvent() })).resolves.toBeUndefined();
    });

    it('relança erros que não são P2003/P2025', async () => {
      const { service, tx } = buildService();
      (tx.subscription.upsert as jest.Mock).mockRejectedValue(new Error('boom'));

      await expect(service.processEvent({ api_version: '1.0', event: buildEvent() })).rejects.toThrow('boom');
    });
  });

  describe('processEvent — mapeamento de status por tipo de evento', () => {
    it.each([
      ['INITIAL_PURCHASE', undefined, 'ATIVA'],
      ['INITIAL_PURCHASE', 'TRIAL', 'TRIAL'],
      ['RENEWAL', undefined, 'ATIVA'],
      ['UNCANCELLATION', undefined, 'ATIVA'],
      ['EXPIRATION', undefined, 'EXPIRADA'],
    ] as const)('%s (period_type=%s) → status %s', async (type, periodType, expectedStatus) => {
      const { service, tx } = buildService();

      await service.processEvent({
        api_version: '1.0',
        event: buildEvent({ type, period_type: periodType as never }),
      });

      expect(tx.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ status: expectedStatus }) }),
      );
    });

    it('CANCELLATION não altera status, só autoRenew=false', async () => {
      const { service, tx } = buildService();

      await service.processEvent({ api_version: '1.0', event: buildEvent({ type: 'CANCELLATION' }) });

      const call = (tx.subscription.upsert as jest.Mock).mock.calls[0][0];
      expect(call.update.status).toBeUndefined();
      expect(call.update.autoRenew).toBe(false);
    });

    it('BILLING_ISSUE não altera status nem autoRenew', async () => {
      const { service, tx } = buildService();

      await service.processEvent({ api_version: '1.0', event: buildEvent({ type: 'BILLING_ISSUE' }) });

      const call = (tx.subscription.upsert as jest.Mock).mock.calls[0][0];
      expect(call.update.status).toBeUndefined();
      expect(call.update.autoRenew).toBeUndefined();
    });
  });

  describe('processEvent — produto desconhecido', () => {
    it('loga warning mas segue quando product_id não corresponde a nenhum Plan', async () => {
      const { service, txPlan, logger, tx } = buildService();
      txPlan.findUnique.mockResolvedValue(null);

      await service.processEvent({ api_version: '1.0', event: buildEvent({ product_id: 'unknown_product' }) });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'revenuecat_webhook_unknown_product' }),
        expect.any(String),
      );
      expect(tx.subscription.upsert).toHaveBeenCalled();
    });
  });

  describe('processEvent — PaymentHistoryEntry', () => {
    it.each(['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'REFUND_REVERSED'])(
      '%s cria PaymentHistoryEntry com status PAGO',
      async (type) => {
        const { service, txPaymentHistoryEntry } = buildService();

        await service.processEvent({ api_version: '1.0', event: buildEvent({ type, price: 9.9, currency: 'BRL' }) });

        expect(txPaymentHistoryEntry.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: 'PAGO', amountCents: 990, currency: 'BRL' }),
          }),
        );
      },
    );

    it('BILLING_ISSUE cria PaymentHistoryEntry com status FALHOU', async () => {
      const { service, txPaymentHistoryEntry } = buildService();

      await service.processEvent({ api_version: '1.0', event: buildEvent({ type: 'BILLING_ISSUE' }) });

      expect(txPaymentHistoryEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FALHOU' }) }),
      );
    });

    it('tipos não financeiros (ex.: CANCELLATION) não criam PaymentHistoryEntry', async () => {
      const { service, txPaymentHistoryEntry } = buildService();

      await service.processEvent({ api_version: '1.0', event: buildEvent({ type: 'CANCELLATION' }) });

      expect(txPaymentHistoryEntry.create).not.toHaveBeenCalled();
    });

    it('ignora P2002 ao criar PaymentHistoryEntry (garantia redundante de idempotência)', async () => {
      const { service, txPaymentHistoryEntry } = buildService();
      txPaymentHistoryEntry.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.processEvent({ api_version: '1.0', event: buildEvent({ type: 'INITIAL_PURCHASE' }) }),
      ).resolves.toBeUndefined();
    });

    it('relança erros inesperados ao criar PaymentHistoryEntry', async () => {
      const { service, txPaymentHistoryEntry } = buildService();
      txPaymentHistoryEntry.create.mockRejectedValue(new Error('boom'));

      await expect(
        service.processEvent({ api_version: '1.0', event: buildEvent({ type: 'INITIAL_PURCHASE' }) }),
      ).rejects.toThrow('boom');
    });
  });
});
