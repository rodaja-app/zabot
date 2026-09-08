import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AntiBanService } from './anti-ban.service';
import { DeadLetterQueueService } from './dead-letter.queue';
import { SendMessageProcessorService } from './send-message-processor.service';
import { SendMessageQueueService } from './send-message.queue';
import { SendMessageWorker } from './send-message.worker';
import { TimezoneService } from './timezone.service';

/**
 * Etapa 15 (Fila, envio e anti-ban — README raiz §6/15). Agrupa produtor
 * (`SendMessageQueueService`), consumidor (`SendMessageWorker` +
 * `SendMessageProcessorService`) e as políticas de negócio que o processor
 * usa (`TimezoneService`, `AntiBanService`) mais a trilha operacional
 * (`DeadLetterQueueService`) — mesmo padrão de módulo único
 * produtor+consumidor de `ContactsModule`/`ValidateNumbersQueueService`+`ValidateNumbersWorker`
 * na etapa 13, só que aqui em pasta própria (`src/sending`) por já serem 6
 * arquivos, em vez de dentro de `CampaignsModule`.
 *
 * `WhatsAppModule` fornece `WhatsAppProvider` (sendMessage) e `SessionService`
 * (getOrCreateSession/publishStats). `forwardRef(() => CampaignsModule)`:
 * `SendMessageProcessorService` precisa de `PersonalizationService` e
 * `MEDIA_STORAGE_PROVIDER` (ambos exportados por `CampaignsModule`), e
 * `CampaignsModule` importa este módulo de volta para `CampaignsService`
 * chamar `enqueueCampaign`/`ensureWorker` — ciclo de MÓDULOS genuíno, não de
 * providers, resolvido do jeito documentado pelo Nest (ver comentário em
 * `campaigns.module.ts`).
 */
@Module({
  imports: [ConfigModule, WhatsAppModule, forwardRef(() => CampaignsModule)],
  providers: [
    TimezoneService,
    AntiBanService,
    DeadLetterQueueService,
    SendMessageProcessorService,
    SendMessageWorker,
    SendMessageQueueService,
  ],
  exports: [SendMessageQueueService, SendMessageWorker],
})
export class SendingModule {}
