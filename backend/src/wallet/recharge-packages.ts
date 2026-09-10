/**
 * Etapa de recarga (carteira de créditos, Pix/Mercado Pago — substitui o
 * antigo `Plan` do modelo de assinatura). Catálogo FIXO de 5 pacotes,
 * decisão do usuário — não é uma fórmula contínua por real, são 5 tiers
 * discretos com bônus progressivo:
 *
 *   Recarga   Base    Bônus   Total créditos   Preço efetivo/crédito
 *   R$20      200     10%     220              R$0,0909
 *   R$50      500     20%     600              R$0,0833
 *   R$100     1.000   35%     1.350            R$0,0741
 *   R$300     3.000   50%     4.500            R$0,0667
 *   R$500     5.000   65%     8.250            R$0,0606
 *
 * `base` = valor em reais × 10 (1 crédito "cheio" = R$0,10); `credits` =
 * `base` já com o bônus aplicado (arredondado — todos os 5 casos batem
 * exato, sem resto). `id` é estável e nunca reaproveitado para outro valor
 * (referenciado por `WalletTransaction`/logs) — trocar preços no futuro
 * significa adicionar um novo `id`, nunca redefinir um existente.
 */
export interface RechargePackage {
  id: string;
  amountCents: number;
  credits: number;
  bonusPercent: number;
}

export const RECHARGE_PACKAGES: readonly RechargePackage[] = [
  { id: 'recarga-20', amountCents: 2_000, credits: 220, bonusPercent: 10 },
  { id: 'recarga-50', amountCents: 5_000, credits: 600, bonusPercent: 20 },
  { id: 'recarga-100', amountCents: 10_000, credits: 1_350, bonusPercent: 35 },
  { id: 'recarga-300', amountCents: 30_000, credits: 4_500, bonusPercent: 50 },
  { id: 'recarga-500', amountCents: 50_000, credits: 8_250, bonusPercent: 65 },
];

export function findRechargePackage(id: string): RechargePackage | undefined {
  return RECHARGE_PACKAGES.find((pkg) => pkg.id === id);
}
