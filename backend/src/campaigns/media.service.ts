import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CampaignMediaType } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { ErrorCategory } from '../common/errors/error-category.enum';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignMediaDto } from './dto/campaign-media.dto';
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from './media-storage-provider.interface';

export type UploadableCampaignMediaType = Exclude<CampaignMediaType, 'NENHUMA'>;

interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

interface MediaRule {
  /** `undefined` = qualquer mimetype aceito (DOCUMENTO é o "catch-all" do WhatsApp — pdf, docx, xlsx, zip, etc.). */
  mimeTypes?: string[];
  maxSizeBytes: number;
}

/**
 * Limites práticos de mídia do WhatsApp por categoria (README raiz §5/13 —
 * "upload/processamento de mídia"). "Processamento" aqui é validação
 * (mimetype + tamanho com causa específica no erro), não transcodificação —
 * o próprio Baileys/WhatsApp lida com o arquivo original na hora do envio
 * (etapa 15); adicionar redimensionamento/compressão de imagem seria código
 * a mais sem requisito correspondente no README.
 */
const MEDIA_RULES: Record<UploadableCampaignMediaType, MediaRule> = {
  IMAGENS: { mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], maxSizeBytes: 16 * 1024 * 1024 },
  AUDIO: {
    mimeTypes: ['audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/amr', 'audio/wav'],
    maxSizeBytes: 16 * 1024 * 1024,
  },
  DOCUMENTO: { maxSizeBytes: 100 * 1024 * 1024 },
};

/**
 * Etapa 14 — upload de mídia de campanha. Existe como endpoint próprio
 * (`POST /campaigns/media`, fora do corpo JSON de `POST /campaigns`) porque
 * o contrato mockado do front (`MessageRepository.createCampaign`) não tem
 * parâmetro nenhum para bytes de arquivo — só `mediaType`/`mediaCount` (ver
 * backend/README.md "Etapa 14" para a decisão completa). O arquivo fica
 * "órfão" (sem `campaignId`) até `CampaignsService.createCampaign` adotá-lo
 * via `mediaIds`.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly storage: MediaStorageProvider,
  ) {}

  async upload(userId: string, type: UploadableCampaignMediaType, file: UploadedFile): Promise<CampaignMediaDto> {
    this.assertValid(type, file);

    const storageKey = `${userId}/${randomUUID()}`;
    await this.storage.save(storageKey, file.buffer, file.mimetype);

    const media = await this.prisma.withTenantContext(userId, (tx) =>
      tx.campaignMedia.create({
        data: { userId, type, storageKey, mimeType: file.mimetype, sizeBytes: file.size },
      }),
    );

    return { id: media.id, mimeType: media.mimeType, sizeBytes: media.sizeBytes };
  }

  private assertValid(type: UploadableCampaignMediaType, file: UploadedFile): void {
    const rule = MEDIA_RULES[type];

    if (rule.mimeTypes && !rule.mimeTypes.includes(file.mimetype)) {
      throw new AppError(
        `Arquivo do tipo "${file.mimetype}" não é aceito para mídia "${type}" (aceitos: ${rule.mimeTypes.join(', ')})`,
        ErrorCategory.VALIDACAO,
        { type, mimetype: file.mimetype, allowed: rule.mimeTypes },
      );
    }

    if (file.size > rule.maxSizeBytes) {
      throw new AppError(
        `Arquivo de ${(file.size / 1_048_576).toFixed(1)}MB excede o limite de ${(rule.maxSizeBytes / 1_048_576).toFixed(0)}MB para mídia "${type}"`,
        ErrorCategory.VALIDACAO,
        { type, sizeBytes: file.size, maxSizeBytes: rule.maxSizeBytes },
      );
    }
  }
}
