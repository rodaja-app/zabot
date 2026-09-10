import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { SendingModule } from '../sending/sending.module';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { LocalDiskMediaStorageProvider } from './local-disk-media-storage.provider';
import { MEDIA_STORAGE_PROVIDER } from './media-storage-provider.interface';
import { MediaService } from './media.service';
import { PersonalizationService } from './personalization.service';
import { S3MediaStorageProvider } from './s3-media-storage.provider';

/**
 * Etapa 14 (Motor de mensagens e campanhas — README raiz §5/6/7/13).
 * `MEDIA_STORAGE_PROVIDER` escolhe S3-compatível (AWS S3/R2/MinIO) quando
 * `S3_BUCKET` está configurado, senão cai para disco local — mesmo padrão de
 * fallback-via-factory do `EmailModule` (ver email.module.ts). `PersonalizationService`
 * é exportado porque a etapa 15 (worker de envio) precisa renderizar os
 * tokens `{IDn}` na hora de montar cada mensagem individual; `MEDIA_STORAGE_PROVIDER`
 * pelo mesmo motivo — `SendMessageProcessorService` lê a mídia adotada pela
 * campanha para anexar na mensagem de `order === 0` (README raiz "Etapa 15").
 *
 * `forwardRef(() => SendingModule)`: `CampaignsService.createCampaign` chama
 * `SendMessageQueueService.enqueueCampaign`/`SendMessageWorker.ensureWorker`
 * depois de persistir a campanha, e `SendingModule` importa `CampaignsModule`
 * de volta (para `PersonalizationService`/`MEDIA_STORAGE_PROVIDER`) — ciclo
 * de MÓDULOS genuíno, não de providers (nenhum provider daqui injeta algo
 * que volte a injetar ele mesmo), resolvido do jeito documentado pelo Nest
 * (https://docs.nestjs.com/fundamentals/circular-dependency): `forwardRef`
 * nos dois `imports`, sem precisar de `forwardRef` nos construtores.
 *
 * O débito de créditos da carteira (`CampaignsService.debitWalletOrThrow`)
 * acessa `Wallet`/`WalletTransaction` direto via `PrismaService`, dentro da
 * mesma transação — não precisa importar `WalletModule` aqui por causa disso
 * (só o lado "crédito": saldo, pacotes, recarga Pix e webhook, ver
 * wallet.module.ts).
 */
@Module({
  imports: [ConfigModule, JwtModule.register({}), forwardRef(() => SendingModule)],
  controllers: [CampaignsController],
  providers: [
    CampaignsService,
    MediaService,
    PersonalizationService,
    LocalDiskMediaStorageProvider,
    S3MediaStorageProvider,
    {
      provide: MEDIA_STORAGE_PROVIDER,
      useFactory: (config: ConfigService, s3: S3MediaStorageProvider, disk: LocalDiskMediaStorageProvider) =>
        config.get<string>('S3_BUCKET') ? s3 : disk,
      inject: [ConfigService, S3MediaStorageProvider, LocalDiskMediaStorageProvider],
    },
  ],
  exports: [CampaignsService, PersonalizationService, MEDIA_STORAGE_PROVIDER],
})
export class CampaignsModule {}
