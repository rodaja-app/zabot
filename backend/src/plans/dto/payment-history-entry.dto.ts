import { PaymentHistoryEntry, PaymentStatus } from '@prisma/client';

/**
 * Espelha `PaymentHistoryEntry` do front (lib/data/models/payment_history_entry.dart):
 * `status` aqui é o enum Português do Prisma (`PAGO`/`PENDENTE`/`FALHOU`) —
 * mapeamento para `AppStatus.sent/pending/failed` fica na etapa 18, mesma
 * convenção de `CurrentPlanDto`/`CampaignDto`. `amountLabel` do mock (ex.:
 * "R$ 99,90") também não é formatado aqui — vai como `amountCents`+`currency`
 * crus; formatação de moeda é responsabilidade de exibição, não do backend.
 */
export interface PaymentHistoryEntryDto {
  id: string;
  eventType: string;
  status: PaymentStatus;
  amountCents: number | null;
  currency: string | null;
  occurredAt: string;
}

export function toPaymentHistoryEntryDto(entry: PaymentHistoryEntry): PaymentHistoryEntryDto {
  return {
    id: entry.id,
    eventType: entry.eventType,
    status: entry.status,
    amountCents: entry.amountCents,
    currency: entry.currency,
    occurredAt: entry.occurredAt.toISOString(),
  };
}
