import { UsageLimitExceededError } from '../common/errors/app-error';
import { PlansService } from './plans.service';
import { RevenueCatSubscriberResponse } from './revenuecat-api.service';

/**
 * Testes unitários com Prisma e RevenueCatApiService mockados. Cobrem:
 * `getCurrentPlan` com/sem subscription, `getAvailablePlans` marcando
 * `isCurrent`, `getPaymentHistory`, a lógica de escolha de assinatura em
 * `syncFromRevenueCat` (ativa mais distante vs. tudo expirado), e as 3
 * ramificações de `assertWithinUsageLimit` (sem plano usável, limite
 * excedido, conflito de compare-and-swap) + o caminho de sucesso.
 */
describe('PlansService', () => {
  function buildService() {
    const txSubscription = { findUnique: jest.fn(async () => null as unknown), updateMany: jest.fn(async () => ({ count: 1 })) };
    const tx = { subscription: txSubscription };

    const planFindMany = jest.fn(async () => [] as unknown[]);
    const planFindUnique = jest.fn(async () => null as { id: string; messagesLimit: number } | null);
    const subscriptionUpsert = jest.fn(async () => ({}));

    const prisma = {
      plan: { findMany: planFindMany, findUnique: planFindUnique },
      subscription: { upsert: subscriptionUpsert },
      withTenantContext: jest.fn((_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
    };
    const revenueCatApi = { getSubscriber: jest.fn() };
    const logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn(), debug: jest.fn() };

    const service = new PlansService(prisma as never, revenueCatApi as never, logger as never);
    return { service, prisma, tx, txSubscription, planFindMany, planFindUnique, subscriptionUpsert, revenueCatApi, logger };
  }

  describe('getCurrentPlan', () => {
    it('sem subscription, retorna DTO com status EXPIRADA e campos de plano nulos', async () => {
      const { service, txSubscription } = buildService();
      txSubscription.findUnique.mockResolvedValue(null);

      const result = await service.getCurrentPlan('user-1');

      expect(result).toEqual({
        planKey: null,
        planName: null,
        priceLabel: null,
        status: 'EXPIRADA',
        autoRenew: false,
        currentPeriodEnd: null,
        messagesUsed: 0,
        messagesLimit: null,
      });
    });

    it('com subscription e plano, mapeia todos os campos', async () => {
      const { service, txSubscription } = buildService();
      txSubscription.findUnique.mockResolvedValue({
        status: 'ATIVA',
        autoRenew: true,
        currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
        messagesUsed: 10,
        plan: { key: 'pro', name: 'Pro', priceLabel: 'R$ 99,90', messagesLimit: 1000 },
      });

      const result = await service.getCurrentPlan('user-1');

      expect(result).toEqual({
        planKey: 'pro',
        planName: 'Pro',
        priceLabel: 'R$ 99,90',
        status: 'ATIVA',
        autoRenew: true,
        currentPeriodEnd: '2026-02-01T00:00:00.000Z',
        messagesUsed: 10,
        messagesLimit: 1000,
      });
    });
  });

  describe('getAvailablePlans', () => {
    it('marca isCurrent apenas para o plano da subscription do usuário', async () => {
      const { service, planFindMany, txSubscription } = buildService();
      planFindMany.mockResolvedValue([
        { id: 'plan-1', key: 'basic', name: 'Basic', priceLabel: 'R$ 29,90', messagesLimit: 100, revenueCatProductId: 'p1' },
        { id: 'plan-2', key: 'pro', name: 'Pro', priceLabel: 'R$ 99,90', messagesLimit: 1000, revenueCatProductId: 'p2' },
      ]);
      txSubscription.findUnique.mockResolvedValue({ planId: 'plan-2' });

      const result = await service.getAvailablePlans('user-1');

      expect(result.find((p) => p.id === 'plan-1')?.isCurrent).toBe(false);
      expect(result.find((p) => p.id === 'plan-2')?.isCurrent).toBe(true);
    });

    it('sem subscription, nenhum plano é isCurrent', async () => {
      const { service, planFindMany, txSubscription } = buildService();
      planFindMany.mockResolvedValue([
        { id: 'plan-1', key: 'basic', name: 'Basic', priceLabel: 'R$ 29,90', messagesLimit: 100, revenueCatProductId: 'p1' },
      ]);
      txSubscription.findUnique.mockResolvedValue(null);

      const result = await service.getAvailablePlans('user-1');

      expect(result[0].isCurrent).toBe(false);
    });
  });

  describe('getPaymentHistory', () => {
    it('retorna entradas ordenadas mapeadas para o DTO', async () => {
      const { service, tx } = buildService();
      (tx as never as { paymentHistoryEntry: { findMany: jest.Mock } }).paymentHistoryEntry = {
        findMany: jest.fn(async () => [
          {
            id: 'entry-1',
            eventType: 'INITIAL_PURCHASE',
            status: 'PAGO',
            amountCents: 990,
            currency: 'BRL',
            occurredAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ]),
      };

      const result = await service.getPaymentHistory('user-1');

      expect(result).toEqual([
        {
          id: 'entry-1',
          eventType: 'INITIAL_PURCHASE',
          status: 'PAGO',
          amountCents: 990,
          currency: 'BRL',
          occurredAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
    });
  });

  describe('syncFromRevenueCat', () => {
    function buildSubscriberResponse(
      subscriptions: RevenueCatSubscriberResponse['subscriber']['subscriptions'],
    ): RevenueCatSubscriberResponse {
      return {
        request_date: '2026-01-01T00:00:00Z',
        request_date_ms: 1,
        subscriber: {
          original_app_user_id: 'user-1',
          first_seen: '2026-01-01T00:00:00Z',
          last_seen: '2026-01-01T00:00:00Z',
          management_url: null,
          original_application_version: null,
          original_purchase_date: null,
          subscriptions,
          entitlements: {},
          non_subscriptions: {},
        },
      };
    }

    it('sem nenhuma subscription na resposta, apenas retorna o plano atual sem upsert', async () => {
      const { service, revenueCatApi, subscriptionUpsert } = buildService();
      revenueCatApi.getSubscriber.mockResolvedValue(buildSubscriberResponse({}));

      await service.syncFromRevenueCat('user-1');

      expect(subscriptionUpsert).not.toHaveBeenCalled();
    });

    it('product_id desconhecido no catálogo: loga warning e não faz upsert', async () => {
      const { service, revenueCatApi, planFindUnique, subscriptionUpsert, logger } = buildService();
      revenueCatApi.getSubscriber.mockResolvedValue(
        buildSubscriberResponse({
          unknown_product: {
            expires_date: null,
            purchase_date: '2026-01-01T00:00:00Z',
            original_purchase_date: '2026-01-01T00:00:00Z',
            period_type: 'normal',
            store: 'PLAY_STORE',
            is_sandbox: false,
            unsubscribe_detected_at: null,
            billing_issues_detected_at: null,
            auto_resume_date: null,
            ownership_type: 'PURCHASED',
            refunded_at: null,
            store_transaction_id: 'tx-1',
          },
        }),
      );
      planFindUnique.mockResolvedValue(null);

      await service.syncFromRevenueCat('user-1');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'revenuecat_sync_unknown_product' }),
        expect.any(String),
      );
      expect(subscriptionUpsert).not.toHaveBeenCalled();
    });

    it('escolhe, entre subscriptions ativas, a de expires_date mais distante no futuro', async () => {
      const { service, revenueCatApi, planFindUnique, subscriptionUpsert } = buildService();
      const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const nearFuture = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();

      revenueCatApi.getSubscriber.mockResolvedValue(
        buildSubscriberResponse({
          product_near: {
            expires_date: nearFuture,
            purchase_date: '2026-01-01T00:00:00Z',
            original_purchase_date: '2026-01-01T00:00:00Z',
            period_type: 'normal',
            store: 'PLAY_STORE',
            is_sandbox: false,
            unsubscribe_detected_at: null,
            billing_issues_detected_at: null,
            auto_resume_date: null,
            ownership_type: 'PURCHASED',
            refunded_at: null,
            store_transaction_id: 'tx-near',
          },
          product_far: {
            expires_date: farFuture,
            purchase_date: '2026-01-01T00:00:00Z',
            original_purchase_date: '2026-01-01T00:00:00Z',
            period_type: 'normal',
            store: 'PLAY_STORE',
            is_sandbox: false,
            unsubscribe_detected_at: null,
            billing_issues_detected_at: null,
            auto_resume_date: null,
            ownership_type: 'PURCHASED',
            refunded_at: null,
            store_transaction_id: 'tx-far',
          },
        }),
      );
      planFindUnique.mockResolvedValue({ id: 'plan-far', messagesLimit: 1000 } as never);

      await service.syncFromRevenueCat('user-1');

      expect(planFindUnique).toHaveBeenCalledWith({ where: { revenueCatProductId: 'product_far' } });
      expect(subscriptionUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ status: 'ATIVA', planId: 'plan-far' }) }),
      );
    });

    it('quando tudo expirado, escolhe a de purchase_date mais recente e marca status EXPIRADA', async () => {
      const { service, revenueCatApi, planFindUnique, subscriptionUpsert } = buildService();
      const past1 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const past2 = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

      revenueCatApi.getSubscriber.mockResolvedValue(
        buildSubscriberResponse({
          product_old: {
            expires_date: past1,
            purchase_date: '2025-01-01T00:00:00Z',
            original_purchase_date: '2025-01-01T00:00:00Z',
            period_type: 'normal',
            store: 'PLAY_STORE',
            is_sandbox: false,
            unsubscribe_detected_at: null,
            billing_issues_detected_at: null,
            auto_resume_date: null,
            ownership_type: 'PURCHASED',
            refunded_at: null,
            store_transaction_id: 'tx-old',
          },
          product_recent: {
            expires_date: past2,
            purchase_date: '2025-06-01T00:00:00Z',
            original_purchase_date: '2025-06-01T00:00:00Z',
            period_type: 'normal',
            store: 'PLAY_STORE',
            is_sandbox: false,
            unsubscribe_detected_at: null,
            billing_issues_detected_at: null,
            auto_resume_date: null,
            ownership_type: 'PURCHASED',
            refunded_at: null,
            store_transaction_id: 'tx-recent',
          },
        }),
      );
      planFindUnique.mockResolvedValue({ id: 'plan-recent', messagesLimit: 1000 } as never);

      await service.syncFromRevenueCat('user-1');

      // past2 > past1 (mais distante no futuro entre 2 expirados == mais recente) — reduce escolhe a maior expiresAtMs.
      expect(planFindUnique).toHaveBeenCalledWith({ where: { revenueCatProductId: 'product_recent' } });
      expect(subscriptionUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ status: 'EXPIRADA', planId: 'plan-recent' }) }),
      );
    });

    it('period_type trial em subscription ativa mapeia para status TRIAL', async () => {
      const { service, revenueCatApi, planFindUnique, subscriptionUpsert } = buildService();
      const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

      revenueCatApi.getSubscriber.mockResolvedValue(
        buildSubscriberResponse({
          trial_product: {
            expires_date: future,
            purchase_date: '2026-01-01T00:00:00Z',
            original_purchase_date: '2026-01-01T00:00:00Z',
            period_type: 'trial',
            store: 'PLAY_STORE',
            is_sandbox: true,
            unsubscribe_detected_at: null,
            billing_issues_detected_at: null,
            auto_resume_date: null,
            ownership_type: 'PURCHASED',
            refunded_at: null,
            store_transaction_id: 'tx-trial',
          },
        }),
      );
      planFindUnique.mockResolvedValue({ id: 'plan-trial', messagesLimit: 100 } as never);

      await service.syncFromRevenueCat('user-1');

      expect(subscriptionUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ status: 'TRIAL' }) }),
      );
    });
  });

  describe('assertWithinUsageLimit', () => {
    it('quantity <= 0 é no-op, sem consultar subscription', async () => {
      const { service, txSubscription, tx } = buildService();

      await service.assertWithinUsageLimit(tx as never, 'user-1', 0);

      expect(txSubscription.findUnique).not.toHaveBeenCalled();
    });

    it('sem subscription, lança UsageLimitExceededError', async () => {
      const { service, txSubscription, tx } = buildService();
      txSubscription.findUnique.mockResolvedValue(null);

      await expect(service.assertWithinUsageLimit(tx as never, 'user-1', 5)).rejects.toBeInstanceOf(UsageLimitExceededError);
    });

    it('subscription EXPIRADA é tratada como sem plano usável', async () => {
      const { service, txSubscription, tx } = buildService();
      txSubscription.findUnique.mockResolvedValue({ status: 'EXPIRADA', plan: { messagesLimit: 100 }, messagesUsed: 0 });

      await expect(service.assertWithinUsageLimit(tx as never, 'user-1', 5)).rejects.toBeInstanceOf(UsageLimitExceededError);
    });

    it('sem plan associado (mesmo status != EXPIRADA) é tratada como sem plano usável', async () => {
      const { service, txSubscription, tx } = buildService();
      txSubscription.findUnique.mockResolvedValue({ status: 'ATIVA', plan: null, messagesUsed: 0 });

      await expect(service.assertWithinUsageLimit(tx as never, 'user-1', 5)).rejects.toBeInstanceOf(UsageLimitExceededError);
    });

    it('quantity acima do restante do limite lança UsageLimitExceededError', async () => {
      const { service, txSubscription, tx } = buildService();
      txSubscription.findUnique.mockResolvedValue({ status: 'ATIVA', plan: { messagesLimit: 100 }, messagesUsed: 98 });

      await expect(service.assertWithinUsageLimit(tx as never, 'user-1', 5)).rejects.toBeInstanceOf(UsageLimitExceededError);
    });

    it('dentro do limite, incrementa messagesUsed via compare-and-swap', async () => {
      const { service, txSubscription, tx } = buildService();
      txSubscription.findUnique.mockResolvedValue({ status: 'ATIVA', plan: { messagesLimit: 100 }, messagesUsed: 50 });
      txSubscription.updateMany.mockResolvedValue({ count: 1 });

      await service.assertWithinUsageLimit(tx as never, 'user-1', 10);

      expect(txSubscription.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', messagesUsed: 50 },
        data: { messagesUsed: { increment: 10 } },
      });
    });

    it('conflito de compare-and-swap (count 0) lança UsageLimitExceededError', async () => {
      const { service, txSubscription, tx } = buildService();
      txSubscription.findUnique.mockResolvedValue({ status: 'ATIVA', plan: { messagesLimit: 100 }, messagesUsed: 50 });
      txSubscription.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.assertWithinUsageLimit(tx as never, 'user-1', 10)).rejects.toBeInstanceOf(UsageLimitExceededError);
    });

    it('status TRIAL com plano é tratado como plano usável', async () => {
      const { service, txSubscription, tx } = buildService();
      txSubscription.findUnique.mockResolvedValue({ status: 'TRIAL', plan: { messagesLimit: 100 }, messagesUsed: 0 });
      txSubscription.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.assertWithinUsageLimit(tx as never, 'user-1', 10)).resolves.toBeUndefined();
    });
  });
});
