/** Resposta de `POST /campaigns/media` — id opaco usado depois em `CreateCampaignDto.mediaIds`. */
export interface CampaignMediaDto {
  id: string;
  mimeType: string;
  sizeBytes: number;
}
