import { BadRequestException, Body, Controller, Delete, Get, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CampaignsService } from './campaigns.service';
import { CampaignMediaDto } from './dto/campaign-media.dto';
import { CampaignDto } from './dto/campaign.dto';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UploadMediaDto } from './dto/upload-media.dto';
import { MediaService } from './media.service';

/**
 * Rotas mapeadas 1:1 com `MessageRepository` do front (README §13), com 1
 * extensão (`POST /campaigns/media`) que o contrato mockado não tem — ver
 * `MediaService` e `CampaignsService` para o porquê.
 */
@UseGuards(JwtAuthGuard)
@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly campaignsService: CampaignsService,
    private readonly mediaService: MediaService,
  ) {}

  @Get()
  getCampaigns(@CurrentUserId() userId: string): Promise<CampaignDto[]> {
    return this.campaignsService.getCampaigns(userId);
  }

  @Post()
  createCampaign(@CurrentUserId() userId: string, @Body() dto: CreateCampaignDto): Promise<CampaignDto[]> {
    return this.campaignsService.createCampaign(userId, dto);
  }

  @Delete('history')
  clearHistory(@CurrentUserId() userId: string): Promise<CampaignDto[]> {
    return this.campaignsService.clearHistory(userId);
  }

  /**
   * Upload "órfão" (sem `campaignId` ainda) — o arquivo só é vinculado a uma
   * campanha quando `POST /campaigns` recebe o id retornado aqui em
   * `mediaIds`. Limite de 100MB no interceptor cobre o maior caso (DOCUMENTO);
   * `MediaService.assertValid` refina por tipo (imagens/áudio ficam em 16MB).
   */
  @Post('media')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } }))
  uploadMedia(
    @CurrentUserId() userId: string,
    @Body() dto: UploadMediaDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<CampaignMediaDto> {
    if (!file) {
      throw new BadRequestException('Arquivo obrigatório no campo "file".');
    }
    return this.mediaService.upload(userId, dto.type, { buffer: file.buffer, mimetype: file.mimetype, size: file.size });
  }
}
