import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

/**
 * Guarda de rota para access token JWT. Implementação própria em vez de
 * `@nestjs/passport` + `passport-jwt`: mesma robustez (verifica assinatura e
 * expiração via a mesma lib que assina os tokens) com duas dependências a
 * menos e sem a indireção das estratégias do Passport para um caso de uso
 * único (Bearer token).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

    if (!token) {
      throw new UnauthorizedException('Token de acesso ausente.');
    }

    try {
      const payload = this.jwt.verify<{ sub: string }>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      request.userId = payload.sub;
      return true;
    } catch (err) {
      throw new UnauthorizedException(
        (err as Error).message === 'jwt expired'
          ? 'Token de acesso expirado.'
          : 'Token de acesso inválido.',
      );
    }
  }
}
