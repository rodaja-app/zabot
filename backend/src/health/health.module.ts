import { Module } from '@nestjs/common';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  // WhatsAppModule importado só para injetar `ProxyConfigService` (exportado
  // de lá) no `HealthController` — diagnóstico `GET /health/whatsapp`.
  imports: [WhatsAppModule],
  controllers: [HealthController],
  providers: [HealthService],
  // Exportado a partir da etapa 17 — `SettingsModule` (`AppInfoService`)
  // reaproveita os mesmos checks de Postgres/Redis para `serviceStatus`.
  exports: [HealthService],
})
export class HealthModule {}
