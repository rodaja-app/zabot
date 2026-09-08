import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Logger } from 'nestjs-pino';
import { HealthService } from './health.service';

/**
 * `/health` — usado por Railway (healthcheck de deploy) e por monitoramento
 * externo. Verifica Postgres e Redis de verdade (via `HealthService`), não
 * só "processo de pé" — health check que sempre retorna 200 esconde exatamente
 * o tipo de falha que a regra de log robusto existe para pegar.
 *
 * A partir da etapa 17, `HealthService` também é consumido por
 * `AppInfoService` (módulo `settings`) para o card "Sobre" da Tela Menu —
 * este controller ficou só com a resposta HTTP/log, a checagem em si é
 * compartilhada.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthService,
    private readonly logger: Logger,
  ) {}

  @Get()
  async check(@Res() res: Response): Promise<void> {
    const { database, redis, healthy } = await this.health.check();

    if (!healthy) {
      this.logger.warn({ event: 'health_check_down', database, redis }, 'Health check falhou');
    }

    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      status: healthy ? 'ok' : 'error',
      database,
      redis,
      timestamp: new Date().toISOString(),
    });
  }
}
