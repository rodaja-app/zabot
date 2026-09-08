import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Logger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { PasswordService } from '../common/security/password.service';
import { VerificationCodeService } from '../common/security/verification-code.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthEmailService } from './auth-email.service';
import { AccountDto } from './dto/account.dto';
import { AuthTokensDto } from './dto/auth-tokens.dto';
import { ConfirmCodeDto } from './dto/confirm-code.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendCodeDto } from './dto/resend-code.dto';

interface RefreshTokenPayload {
  sub: string;
  jti: string;
  familyId: string;
}

/**
 * Implementação completa da etapa 10 — cadastro com verificação por email,
 * login, JWT (access curto + refresh rotativo com detecção de reuso) e
 * exclusão de conta. Contrato de retorno (o que lança exceção vs. o que
 * simplesmente falha) segue REST convencional: a futura `ApiAuthRepository`
 * (etapa 18, integração final) é quem decide como mapear um 401 para o
 * `Future<bool>` que a tela já espera — não é responsabilidade do backend
 * imitar a assinatura do Dart.
 *
 * Decisão registrada aqui (não estava no mock, que não modela conta
 * "pendente"): login rejeita conta ainda não confirmada (emailVerifiedAt
 * nulo) com 401 — mock simples de bool não tinha esse estado, mas deixar
 * logar sem confirmar o email seria menos robusto que o resto do sistema.
 */
@Injectable()
export class AuthService {
  /** Access token de vida curta — só o suficiente para não forçar refresh a cada request. */
  private readonly accessTokenTtl = '15m';
  /** Refresh token de vida longa — sessão "lembrada" no app mobile. */
  private readonly refreshTokenTtlSeconds = 60 * 60 * 24 * 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly password: PasswordService,
    private readonly verificationCode: VerificationCodeService,
    private readonly authEmail: AuthEmailService,
    private readonly logger: Logger,
  ) {}

  async register(dto: RegisterDto): Promise<void> {
    const email = normalizeEmail(dto.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing?.emailVerifiedAt) {
      throw new ConflictException('Já existe uma conta confirmada com este email.');
    }

    const passwordHash = await this.password.hash(dto.password);

    // Reenviar o cadastro para um email com conta pendente (ainda não
    // confirmada) atualiza os dados e reemite um código novo, em vez de
    // rejeitar — cobre o caso comum de o usuário ter fechado o app antes de
    // confirmar e tentar cadastrar de novo.
    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: { name: dto.name, passwordHash },
        })
      : await this.prisma.user.create({
          data: { name: dto.name, email, passwordHash },
        });

    await this.issueAndSendVerificationCode(user.id, email);
  }

  async resendCode(dto: ResendCodeDto): Promise<void> {
    const email = normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || user.emailVerifiedAt) {
      // Resposta uniforme (sem erro) tanto para email inexistente quanto
      // para conta já confirmada — evita enumeração de contas via este
      // endpoint. A causa real ainda fica registrada no log interno.
      this.logger.warn(
        { event: 'resend_code_noop', email },
        'Reenvio de código pedido para email inexistente ou já confirmado',
      );
      return;
    }

    await this.issueAndSendVerificationCode(user.id, email);
  }

  async confirmCode(dto: ConfirmCodeDto): Promise<AuthTokensDto> {
    const email = normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Código inválido.');
    }

    const pending = await this.prisma.verificationCode.findFirst({
      where: { userId: user.id, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!pending || pending.expiresAt < new Date()) {
      throw new UnauthorizedException('Código expirado ou inexistente — solicite um novo.');
    }

    if (pending.attempts >= this.verificationCode.maxAttempts) {
      throw new UnauthorizedException('Número máximo de tentativas excedido — solicite um novo código.');
    }

    if (this.verificationCode.hash(dto.code) !== pending.codeHash) {
      await this.prisma.verificationCode.update({
        where: { id: pending.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Código inválido.');
    }

    await this.prisma.$transaction([
      this.prisma.verificationCode.update({
        where: { id: pending.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);

    // Login automático pós-confirmação — exigido pelo fluxo do front
    // (ConfirmacaoCodigoScreen vai direto para RootShellScreen).
    return this.issueTokenPair(user.id);
  }

  async login(dto: LoginDto): Promise<AuthTokensDto> {
    const email = normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Faz um hash "no vazio" para manter tempo de resposta parecido com o
      // caso de senha errada — dificulta enumerar emails cadastrados por
      // timing. Custo de uma chamada de argon2 a mais, robustez a mais.
      await this.password.hash(dto.password);
      throw new UnauthorizedException('Email ou senha inválidos.');
    }

    const passwordMatches = await this.password.verify(user.passwordHash, dto.password);
    if (!passwordMatches) {
      throw new UnauthorizedException('Email ou senha inválidos.');
    }

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException('Conta ainda não confirmada — verifique o código enviado por email.');
    }

    return this.issueTokenPair(user.id);
  }

  async refresh(refreshToken: string): Promise<AuthTokensDto> {
    const payload = this.verifyRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { id: payload.jti } });

    if (!stored || stored.userId !== payload.sub) {
      throw new UnauthorizedException('Refresh token inválido.');
    }

    if (stored.status !== 'ATIVO') {
      // Token já rotacionado ou revogado sendo reapresentado — reuso real,
      // indício de token roubado. Revoga a família inteira (todos os
      // descendentes dessa cadeia de rotação) e força novo login.
      await this.revokeFamily(stored.familyId);
      this.logger.error(
        { event: 'refresh_token_reuse_detected', userId: stored.userId, familyId: stored.familyId },
        'Reuso de refresh token detectado — família de tokens revogada por segurança',
      );
      throw new UnauthorizedException('Sessão inválida — faça login novamente.');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expirado — faça login novamente.');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { status: 'ROTACIONADO', revokedAt: new Date() },
    });

    return this.issueTokenPair(stored.userId, stored.familyId);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;

    try {
      const payload = this.verifyRefreshToken(refreshToken);
      const stored = await this.prisma.refreshToken.findUnique({ where: { id: payload.jti } });
      if (stored) {
        await this.revokeFamily(stored.familyId);
      }
    } catch (err) {
      // Logout é best-effort: token já expirado/inválido não deve impedir o
      // cliente de encerrar a sessão localmente — só registra a causa.
      this.logger.warn(
        { event: 'logout_refresh_invalid', details: (err as Error).message },
        'Refresh token inválido/expirado no logout — ignorado, sessão local pode encerrar normalmente',
      );
    }
  }

  async getAccount(userId: string): Promise<AccountDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    if (!user) {
      // Não deveria acontecer com um access token válido (usuário deletado
      // sem invalidar tokens em circulação) — 404 é mais correto que 401
      // aqui, já que o token em si é válido.
      throw new NotFoundException('Usuário não encontrado.');
    }
    return user;
  }

  async deleteAccount(userId: string): Promise<void> {
    // onDelete: Cascade (schema.prisma) cuida de VerificationCode e
    // RefreshToken — uma exclusão, sem precisar orquestrar múltiplas queries.
    await this.prisma.user.delete({ where: { id: userId } });
  }

  private async issueAndSendVerificationCode(userId: string, email: string): Promise<void> {
    const { code, hash } = this.verificationCode.generate();
    await this.prisma.verificationCode.create({
      data: {
        userId,
        codeHash: hash,
        expiresAt: new Date(Date.now() + this.verificationCode.ttlMinutes * 60_000),
      },
    });
    await this.authEmail.sendVerificationCode(email, code, this.verificationCode.ttlMinutes);
  }

  private async issueTokenPair(userId: string, familyId?: string): Promise<AuthTokensDto> {
    const jti = randomUUID();
    const family = familyId ?? randomUUID();
    const expiresAt = new Date(Date.now() + this.refreshTokenTtlSeconds * 1000);

    await this.prisma.refreshToken.create({
      data: { id: jti, userId, familyId: family, status: 'ATIVO', expiresAt },
    });

    const accessToken = this.jwt.sign(
      { sub: userId },
      { secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: this.accessTokenTtl },
    );

    const refreshToken = this.jwt.sign(
      { sub: userId, jti, familyId: family } satisfies RefreshTokenPayload,
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.refreshTokenTtlSeconds,
      },
    );

    return { accessToken, refreshToken };
  }

  private verifyRefreshToken(token: string): RefreshTokenPayload {
    try {
      return this.jwt.verify<RefreshTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch (err) {
      throw new UnauthorizedException('Refresh token inválido ou expirado.');
    }
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, status: 'ATIVO' },
      data: { status: 'REVOGADO', revokedAt: new Date() },
    });
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
