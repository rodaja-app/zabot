import { Plan } from '@prisma/client';

/**
 * Espelha `PlanOption` do front (lib/data/models/plan_option.dart) para o
 * diálogo "Comparar planos". `id` aqui é `Plan.id` (uuid interno) — o mock
 * usa esse mesmo `id` como argumento de `changePlan(planId)`, mas a troca de
 * plano de verdade NUNCA acontece por essa rota (ver README raiz "Etapa 16"
 * e `PlansController`): é sempre uma compra nativa via SDK da RevenueCat, que
 * precisa do `revenueCatProductId` (não do `id`/`key` internos) para saber
 * qual produto comprar — por isso ele vai incluído aqui, campo aditivo em
 * relação ao mock. `description` do mock (texto livre "Até N mensagens por
 * mês.") não é gerada aqui — fica para a camada de integração (etapa 18),
 * mesma convenção de não formatar texto de exibição no backend (ver
 * `CampaignDto`).
 */
export interface PlanOptionDto {
  id: string;
  key: string;
  name: string;
  priceLabel: string;
  messagesLimit: number;
  isCurrent: boolean;
  revenueCatProductId: string;
}

export function toPlanOptionDto(plan: Plan, isCurrent: boolean): PlanOptionDto {
  return {
    id: plan.id,
    key: plan.key,
    name: plan.name,
    priceLabel: plan.priceLabel,
    messagesLimit: plan.messagesLimit,
    isCurrent,
    revenueCatProductId: plan.revenueCatProductId,
  };
}
