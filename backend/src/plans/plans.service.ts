import { Injectable } from '@nestjs/common';
import { Prisma, SubscriptionStatus } from '@prisma/client';
import { Logger } from 'nestjs-pino';
import { UsageLimitExceededError } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentPlanDto, toCurrentPlanDto } from './dto/current-plan.dto';
import { PaymentHistoryEntryDto, toPaymentHistoryEntryDto } from './dto/payment-history-entry.dto';
import { PlanOptionDto, toPlanOptionDto } from './dto/plan-option.dto';
import { RevenueCatApiService, RevenueCatSubscriptionInfo } from './revenuecat-api.service';

/**
 * Etapa 16 (Planos e uso — README raiz §16). Camada de negócio sobre
 * `Plan`/`Subscription`/`PaymentHistoryEntry`. Nunca fala HTTP diretamente
 * (isso é `PlansController`) nem processa webhook (isso é
 * `RevenueCatWebhookService`) — só consulta/atualiza estado e aplica a regra
 * de limite de uso, reaproveitada por `CampaignsService`.
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revenueCatApi: RevenueCatApiService,
    private readonly logger: Logger,
  ) {}

  async getCurrentPlan(userId: string): Promise<CurrentPlanDto> {
    const sub = await this.prisma.withTenantContext(userId, (tx) =>
      tx.subscription.findUnique({ where: { userId }, include: { plan: true } }),
    );
    return toCurrentPlanDto(sub);
  }

  /** Catálogo (`plans`) não tem RLS — global, ver comentário do model em schema.prisma. */
  async getAvailablePlans(userId: string): Promise<PlanOptionDto[]> {
    const [plans, sub] = await Promise.all([
      this.prisma.plan.findMany({ orderBy: { messagesLimit: 'asc' } }),
      this.prisma.withTenantContext(userId, (tx) => tx.subscription.findUnique({ where: { userId } })),
    ]);
    return plans.map((plan) => toPlanOptionDto(plan, plan.id === sub?.planId));
  }

  async getPaymentHistory(userId: string): Promise<PaymentHistoryEntryDto[]> {
    const entries = await this.prisma.withTenantContext(userId, (tx) =>
      tx.paymentHistoryEntry.findMany({ where: { userId }, orderBy: { occurredAt: 'desc' } }),
    );
    return entries.map(toPaymentHistoryEntryDto);
  }

  /**
   * Chamado por `POST /plans/sync`, logo após o app completar uma compra
   * nativa via SDK da RevenueCat — evita esperar o webhook (que pode levar
   * de alguns segundos a ~1min para chegar, ver README raiz "Etapa 16").
   * Busca o estado canônico na REST API deles e reconcilia `Subscription`
   * localmente, com a MESMA tradução de estado usada pelo webhook (ver
   * `RevenueCatWebhookService.buildSubscriptionPatch`), adaptada ao formato
   * (diferente) da resposta REST.
   */
  async syncFromRevenueCat(userId: string): Promise<CurrentPlanDto> {
    const response = await this.revenueCatApi.getSubscriber(userId);
    const entries = Object.entries(response.subscriber.subscriptions);

    if (entries.length === 0) {
      this.logger.log(
        { event: 'revenuecat_sync_no_subscriptions', userId },
        'Sync RevenueCat: nenhuma assinatura encontrada para o usuário.',
      );
      return this.getCurrentPlan(userId);
    }

    const chosen = this.chooseSubscriptionEntry(entries);

    const plan = await this.prisma.plan.findUnique({ where: { revenueCatProductId: chosen.productId } });
    if (!plan) {
      this.logger.warn(
        { event: 'revenuecat_sync_unknown_product', userId, productId: chosen.productId },
        'Sync RevenueCat: product_id não corresponde a nenhum Plan do catálogo (seed desatualizado?).',
      );
      return this.getCurrentPlan(userId);
    }

    const now = Date.now();
    const isActive = chosen.expiresAtMs === null || chosen.expiresAtMs > now;
    const status = !isActive
      ? SubscriptionStatus.EXPIRADA
      : chosen.info.period_type === 'trial'
        ? SubscriptionStatus.TRIAL
        : SubscriptionStatus.ATIVA;

    const shared = {
      planId: plan.id,
      status,
      autoRenew: !chosen.info.unsubscribe_detected_at,
      currentPeriodStart: new Date(chosen.info.purchase_date),
      currentPeriodEnd: chosen.info.expires_date ? new Date(chosen.info.expires_date) : null,
      store: chosen.info.store,
      environment: chosen.info.is_sandbox ? 'SANDBOX' : 'PRODUCTION',
      originalTransactionId: chosen.info.store_transaction_id,
      // "SYNC" (não um tipo de evento real da RevenueCat) marca que este foi
      // o último write feito por aqui, não pelo webhook — útil para debugar
      // se os dois caminhos alguma vez divergirem.
      lastEventType: 'SYNC',
      lastEventAt: new Date(),
    };

    await this.prisma.withTenantContext(userId, (tx) =>
      tx.subscription.upsert({
        where: { userId },
        update: shared,
        create: { userId, ...shared },
      }),
    );

    return this.getCurrentPlan(userId);
  }

  /**
   * Entre as assinaturas retornadas pela RevenueCat para este usuário,
   * escolhe: se alguma ainda não expirou (ou é vitalícia, sem `expires_date`),
   * a de expiração mais distante no futuro; senão (tudo expirado), a de
   * `purchase_date` mais recente — resulta em `EXPIRADA` no chamador, mas com
   * o plano correto associado (histórico, não "nenhum plano").
   */
  private chooseSubscriptionEntry(
    entries: [string, RevenueCatSubscriptionInfo][],
  ): { productId: string; info: RevenueCatSubscriptionInfo; expiresAtMs: number | null } {
    const now = Date.now();
    const parsed = entries.map(([productId, info]) => ({
      productId,
      info,
      expiresAtMs: info.expires_date ? Date.parse(info.expires_date) : null,
    }));
    const active = parsed.filter((e) => e.expiresAtMs === null || e.expiresAtMs > now);
    const pool = active.length > 0 ? active : parsed;

    return pool.reduce((best, current) => {
      const bestKey = best.expiresAtMs ?? Infinity;
      const currentKey = current.expiresAtMs ?? Infinity;
      return currentKey > bestKey ? current : best;
    });
  }

  /**
   * Etapa 16 — "Bloquear novos envios" (decisão do usuário): chamado por
   * `CampaignsService.createCampaign` DENTRO da mesma transação (`tx`) que
   * cria os `Envio`s, nunca em uma transação separada — check e incremento
   * de `messagesUsed` precisam ser atômicos com a criação para não permitir
   * 2 campanhas concorrentes estourarem o limite juntas (README raiz "Etapa
   * 16"). `quantity` = destinatários × mensagens da campanha (contagem no
   * momento da CRIAÇÃO/enfileiramento, não de entrega — mesma convenção de
   * `Campaign.recipientCount`).
   *
   * Usuário sem `Subscription`, ou com `status = EXPIRADA`, é tratado
   * uniformemente como "sem plano usável" — não existe um tier grátis
   * separado (simplificação deliberada, fácil de revisar se necessário).
   *
   * O `updateMany` com `messagesUsed: sub.messagesUsed` na cláusula `where`
   * funciona como compare-and-swap: se outra transação já tiver incrementado
   * `messagesUsed` entre o `findUnique` acima e este `update` (mesmo sob
   * READ COMMITTED), `count` vem 0 e a chamada falha em vez de estourar o
   * limite silenciosamente.
   */
  async assertWithinUsageLimit(tx: Prisma.TransactionClient, userId: string, quantity: number): Promise<void> {
    if (quantity <= 0) return;

    const sub = await tx.subscription.findUnique({ where: { userId }, include: { plan: true } });
    if (!sub || sub.status === SubscriptionStatus.EXPIRADA || !sub.plan) {
      throw new UsageLimitExceededError('Nenhum plano ativo — assine um plano para enviar campanhas.', { userId });
    }

    const remaining = sub.plan.messagesLimit - sub.messagesUsed;
    if (quantity > remaining) {
      throw new UsageLimitExceededError(
        `Limite de mensagens do plano atingido (${sub.messagesUsed}/${sub.plan.messagesLimit}).`,
        { userId, limit: sub.plan.messagesLimit, used: sub.messagesUsed, requested: quantity },
      );
    }

    const updated = await tx.subscription.updateMany({
      where: { userId, messagesUsed: sub.messagesUsed },
      data: { messagesUsed: { increment: quantity } },
    });
    if (updated.count === 0) {
      throw new UsageLimitExceededError('Conflito ao registrar uso de mensagens — tente novamente.', { userId });
    }
  }
}
