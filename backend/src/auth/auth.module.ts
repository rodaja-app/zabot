import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthEmailService } from './auth-email.service';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  // JwtModule.register({}) sem segredo/expiração fixos: access e refresh
  // token usam segredos e TTLs diferentes, passados explicitamente em cada
  // chamada de sign/verify (ver auth.service.ts) — mais simples e mais
  // seguro do que registrar dois JwtModule nomeados para o mesmo caso de uso.
  imports: [ConfigModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, AuthEmailService, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
