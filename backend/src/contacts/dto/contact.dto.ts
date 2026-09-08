import { ContactStatus } from '@prisma/client';

/**
 * Espelha `Contact` do front (lib/data/models/contact.dart) — `id`, `phone`,
 * `customFields` são os únicos campos que o front atual lê. `status` e
 * `failureReason` são adições aditivas (README §5 passo 5 — "registro
 * auditável") para quando o front ganhar tela de status de validação; um
 * front que só desserializa os 3 campos originais ignora o resto sem quebrar.
 *
 * `phone` é o telefone confirmado no WhatsApp (`normalizedPhone`, com "+")
 * quando já validado; enquanto PENDENTE/INVALIDO, cai para o que o usuário
 * digitou (`rawPhone`) — nunca fica em branco.
 */
export interface ContactDto {
  id: string;
  phone: string;
  customFields: Record<string, string>;
  status: ContactStatus;
  failureReason: string | null;
}

/** Espelha `ContactImportResult` do front (lib/data/models/contact_import_result.dart). */
export interface ContactImportResultDto {
  contacts: ContactDto[];
  imported: number;
  skipped: number;
}
