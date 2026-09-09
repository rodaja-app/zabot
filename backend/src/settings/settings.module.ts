import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { HealthModule } from '../health/health.module';
import { AppInfoService } from './app-info.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * Etapa 17 (Observabilidade avançada — README raiz §17). Importa
 * `HealthModule` para reaproveitar `HealthService` (checks reais de
 * Postgres/Redis, os mesmos usados por `GET /health`) dentro de
 * `AppInfoService.getAppInfo` — ver comentário de `HealthModule.exports`.
 */
@Module({
  imports: [ConfigModule, JwtModule.register({}), HealthModule],
  controllers: [SettingsController],
  providers: [SettingsService, AppInfoService],
})
export class SettingsModule {}
