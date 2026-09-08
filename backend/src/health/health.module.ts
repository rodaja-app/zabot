import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService],
  // Exportado a partir da etapa 17 — `SettingsModule` (`AppInfoService`)
  // reaproveita os mesmos checks de Postgres/Redis para `serviceStatus`.
  exports: [HealthService],
})
export class HealthModule {}
