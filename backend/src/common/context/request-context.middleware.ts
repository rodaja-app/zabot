import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { RequestContextService } from './request-context.service';

/**
 * Abre o contexto de log no início de toda requisição HTTP (requestId,
 * propagado também no header de resposta pra correlacionar com o
 * front/cliente). Aplicado globalmente em AppModule.configure().
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly context: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    res.setHeader('x-request-id', requestId);
    this.context.run({ requestId }, () => next());
  }
}
