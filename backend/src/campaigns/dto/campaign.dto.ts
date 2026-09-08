import { Campaign, CampaignMediaType, CampaignMessage, CampaignStatus } from '@prisma/client';

/**
 * Espelha `Campaign` do front (lib/data/models/campaign.dart) nos campos que
 * o mock já usa (`messages`, `recipientCount`, `mediaType`, `mediaCount`,
 * `createdAt`, `sentCount`, `pendingCount`, `failedCount` — `progress`/
 * `title`/`totalCount` são getters derivados no front, nunca enviados aqui);
 * `status` aqui é o enum Português do Prisma (`PENDENTE`/`ENVIADA`), igual
 * `ContactDto.status` — campo aditivo, o mapeamento para `AppStatus.pending/
 * sent` fica na camada de integração (etapa 18).
 */
export interface CampaignDto {
  id: string;
  messages: string[];
  recipientCount: number;
  status: CampaignStatus;
  mediaType: CampaignMediaType;
  mediaCount: number;
  createdAt: string;
  sentCount: number;
  pendingCount: number;
  failedCount: number;
}

export function toCampaignDto(campaign: Campaign & { messages: CampaignMessage[] }): CampaignDto {
  return {
    id: campaign.id,
    messages: campaign.messages.map((m) => m.text),
    recipientCount: campaign.recipientCount,
    status: campaign.status,
    mediaType: campaign.mediaType,
    mediaCount: campaign.mediaCount,
    createdAt: campaign.createdAt.toISOString(),
    sentCount: campaign.sentCount,
    pendingCount: campaign.pendingCount,
    failedCount: campaign.failedCount,
  };
}
