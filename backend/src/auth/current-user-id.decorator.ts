import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedRequest } from './jwt-auth.guard';

/** Só usável em rotas protegidas por `JwtAuthGuard` (é quem preenche `request.userId`). */
export const CurrentUserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.userId) {
    throw new UnauthorizedException('Usuário não autenticado.');
  }
  return request.userId;
});
