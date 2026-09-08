import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthService } from '../health/health.service';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { version as packageVersion } from '../../package.json';
import { AppInfoDto, ServiceStatus } from './dto/app-info.dto';

/**
 * Etapa 17 (Observabilidade avançada — README raiz §17/linha 241). Espelha
 * `MenuRepository.getAppInfo()` / `AppInfo` (lib/data/models/app_info.dart).
 *
 * `serviceStatus` deriva dos MESMOS checks reais de Postgres/Redis usados
 * por `GET /health` (ver comentário de `HealthService`) — nunca duplica a
 * lógica nem inventa um terceiro sinal de saúde: ambos "up" = OPERACIONAL,
 * exatamente um "down" = DEGRADADO (serviço ainda responde, só degradado),
 * ambos "down" = FORA_DO_AR.
 */
@Injectable()
export class AppInfoService {
  constructor(
    private readonly health: HealthService,
    private readonly config: ConfigService,
  ) {}

  async getAppInfo(): Promise<AppInfoDto> {
    const { database, redis } = await this.health.check();
    const downCount = [database, redis].filter((check) => check.status === 'down').length;

    const serviceStatus =
      downCount === 0 ? ServiceStatus.OPERACIONAL : downCount === 1 ? ServiceStatus.DEGRADADO : ServiceStatus.FORA_DO_AR;

    return {
      version: this.config.get<string>('APP_VERSION') || packageVersion,
      serviceStatus,
    };
  }
}
