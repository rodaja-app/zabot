import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { RevenueCatApiService } from './revenuecat-api.service';
import { RevenueCatWebhookService } from './revenuecat-webhook.service';

/**
 * Etapa 16 (Planos e uso — README raiz §16). `PlansService` é exportado
 * porque `CampaignsService.createCampaign` chama `assertWithinUsageLimit`
 * dentro da própria transação (README raiz "Etapa 16" — "Bloquear novos
 * envios"). Ao contrário de `CampaignsModule`/`SendingModule`, essa
 * dependência é de mão única: `PlansModule` não precisa de nada de
 * `CampaignsModule` de volta, então nenhum `forwardRef` é necessário aqui —
 * só em `campaigns.module.ts`, que importa este módulo normalmente.
 */
@Module({
  imports: [ConfigModule],
  controllers: [PlansController],
  providers: [PlansService, RevenueCatApiService, RevenueCatWebhookService],
  exports: [PlansService],
})
export class PlansModule {}
