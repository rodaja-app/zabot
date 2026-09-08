import { Plan, Subscription, SubscriptionStatus } from '@prisma/client';

/**
 * Espelha `SubscriptionPlan` do front (lib/data/models/subscription_plan.dart)
 * nos campos que o mock já usa, com a mesma convenção de `CampaignDto`/`ContactDto`:
 * `status` aqui é o enum Português do Prisma (`ATIVA`/`TRIAL`/`EXPIRADA`), e
 * `currentPeriodEnd` vai como ISO — o mapeamento para `AppStatus.connected/
 * pending/failed` e a formatação de data (`renewalDateLabel`, dd/MM/yyyy)
 * ficam na camada de integração (etapa 18), igual já decidido para campanhas.
 *
 * Usuário sem `Subscription` (nunca comprou) OU com `status = EXPIRADA` sem
 * plano associado usa este mesmo formato com todos os campos de plano nulos
 * e `status = EXPIRADA` — não existe um "plano grátis" especial (ver
 * `PlansService.assertWithinUsageLimit` e README raiz "Etapa 16").
 */
export interface CurrentPlanDto {
  planKey: string | null;
  planName: string | null;
  priceLabel: string | null;
  status: SubscriptionStatus;
  autoRenew: boolean;
  currentPeriodEnd: string | null;
  messagesUsed: number;
  messagesLimit: number | null;
}

export function toCurrentPlanDto(sub: (Subscription & { plan: Plan | null }) | null): CurrentPlanDto {
  if (!sub) {
    return {
      planKey: null,
      planName: null,
      priceLabel: null,
      status: SubscriptionStatus.EXPIRADA,
      autoRenew: false,
      currentPeriodEnd: null,
      messagesUsed: 0,
      messagesLimit: null,
    };
  }

  return {
    planKey: sub.plan?.key ?? null,
    planName: sub.plan?.name ?? null,
    priceLabel: sub.plan?.priceLabel ?? null,
    status: sub.status,
    autoRenew: sub.autoRenew,
    currentPeriodEnd: sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
    messagesUsed: sub.messagesUsed,
    messagesLimit: sub.plan?.messagesLimit ?? null,
  };
}
