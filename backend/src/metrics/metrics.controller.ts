import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { MetricsAuthGuard } from './metrics-auth.guard';
import { MetricsService } from './metrics.service';

/**
 * Etapa 17 — endpoint de scraping do Prometheus/Grafana (README raiz §17).
 * Fora do prefixo de negócio (sem JwtAuthGuard de usuário) — autenticado,
 * quando configurado, por `METRICS_TOKEN` via `MetricsAuthGuard`.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @UseGuards(MetricsAuthGuard)
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(): Promise<string> {
    return this.metrics.collect();
  }
}
