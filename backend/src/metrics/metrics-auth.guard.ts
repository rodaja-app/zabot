import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Protege `GET /metrics` — formato Prometheus, sem dado de usuário, mas
 * ainda assim informação operacional interna (nomes de host, contagem de
 * sessões etc.). Se `METRICS_TOKEN` não estiver configurado, o endpoint
 * fica aberto (aceitável em dev local; ver comentário em env.validation.ts).
 * Deliberadamente mais simples que `JwtAuthGuard` (comparação direta de
 * token estático, não JWT) — só existe para scraping do Prometheus/Grafana,
 * não para autenticação de usuário.
 */
@Injectable()
export class MetricsAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('METRICS_TOKEN');
    if (!expected) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

    if (token !== expected) {
      throw new UnauthorizedException('Token de métricas ausente ou inválido.');
    }
    return true;
  }
}
