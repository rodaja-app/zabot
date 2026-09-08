import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * Testes unitários com todas as dependências mockadas (sem Postgres/Redis
 * de verdade) — cobrem as regras de negócio mais sensíveis do módulo:
 * reuso de refresh token (indício de token roubado) e rejeição de login
 * para conta ainda não confirmada, que é a decisão de design mais notável
 * desta etapa em relação ao mock simples do front (que não modelava esse
 * estado intermediário).
 */
describe('AuthService', () => {
  function buildService() {
    const prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
      verificationCode: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    };

    const jwtService = { sign: jest.fn(() => 'token-assinado'), verify: jest.fn() };
    const config = { getOrThrow: jest.fn(() => 'segredo-de-teste-32-caracteres') };
    const passwordService = { hash: jest.fn(async () => 'hash-fake'), verify: jest.fn() };
    const verificationCodeService = {
      ttlMinutes: 15,
      maxAttempts: 5,
      generate: jest.fn(() => ({ code: '123456', hash: 'hash-do-codigo' })),
      hash: jest.fn((code: string) => (code === '123456' ? 'hash-do-codigo' : `hash-de-${code}`)),
    };
    const authEmail = { sendVerificationCode: jest.fn() };
    const logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn(), debug: jest.fn() };

    const service = new AuthService(
      prisma as never,
      jwtService as never,
      config as never,
      passwordService as never,
      verificationCodeService as never,
      authEmail as never,
      logger as never,
    );

    return { service, prisma, jwtService, passwordService, verificationCodeService, authEmail, logger };
  }

  describe('register', () => {
    it('cria usuário novo e envia o código de verificação', async () => {
      const { service, prisma, authEmail } = buildService();
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'user-1' });

      await service.register({ name: 'Raphael', email: 'Raphael@Example.com', password: 'senha12345' });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'raphael@example.com' }) }),
      );
      expect(authEmail.sendVerificationCode).toHaveBeenCalledWith('raphael@example.com', '123456', 15);
    });

    it('rejeita com 409 se já existe conta confirmada com o email', async () => {
      const { service, prisma } = buildService();
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', emailVerifiedAt: new Date() });

      await expect(
        service.register({ name: 'Raphael', email: 'raphael@example.com', password: 'senha12345' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('reaproveita conta pendente (não confirmada) em vez de rejeitar', async () => {
      const { service, prisma } = buildService();
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', emailVerifiedAt: null });
      prisma.user.update.mockResolvedValue({ id: 'user-1' });

      await service.register({ name: 'Raphael', email: 'raphael@example.com', password: 'senha12345' });

      expect(prisma.user.update).toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('rejeita com 401 quando o email não existe', async () => {
      const { service, prisma } = buildService();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login({ email: 'nao-existe@example.com', password: 'x' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejeita com 401 quando a senha está errada', async () => {
      const { service, prisma, passwordService } = buildService();
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', passwordHash: 'hash', emailVerifiedAt: new Date() });
      passwordService.verify.mockResolvedValue(false);

      await expect(service.login({ email: 'raphael@example.com', password: 'errada' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejeita com 401 quando a conta ainda não foi confirmada por email', async () => {
      const { service, prisma, passwordService } = buildService();
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', passwordHash: 'hash', emailVerifiedAt: null });
      passwordService.verify.mockResolvedValue(true);

      await expect(service.login({ email: 'raphael@example.com', password: 'certa' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('emite tokens quando credenciais batem e a conta está confirmada', async () => {
      const { service, prisma, passwordService } = buildService();
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', passwordHash: 'hash', emailVerifiedAt: new Date() });
      passwordService.verify.mockResolvedValue(true);
      prisma.refreshToken.create.mockResolvedValue({});

      const tokens = await service.login({ email: 'raphael@example.com', password: 'certa' });

      expect(tokens).toEqual({ accessToken: 'token-assinado', refreshToken: 'token-assinado' });
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });
  });

  describe('refresh — detecção de reuso', () => {
    it('revoga a família inteira quando um refresh token já ROTACIONADO é reapresentado', async () => {
      const { service, prisma, jwtService } = buildService();
      jwtService.verify.mockReturnValue({ sub: 'user-1', jti: 'jti-antigo', familyId: 'familia-1' });
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'jti-antigo',
        userId: 'user-1',
        familyId: 'familia-1',
        status: 'ROTACIONADO',
        expiresAt: new Date(Date.now() + 1000_000),
      });

      await expect(service.refresh('token-antigo')).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { familyId: 'familia-1', status: 'ATIVO' },
          data: expect.objectContaining({ status: 'REVOGADO' }),
        }),
      );
    });

    it('rotaciona normalmente um refresh token ATIVO e válido', async () => {
      const { service, prisma, jwtService } = buildService();
      jwtService.verify.mockReturnValue({ sub: 'user-1', jti: 'jti-1', familyId: 'familia-1' });
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'jti-1',
        userId: 'user-1',
        familyId: 'familia-1',
        status: 'ATIVO',
        expiresAt: new Date(Date.now() + 1000_000),
      });
      prisma.refreshToken.create.mockResolvedValue({});

      const tokens = await service.refresh('token-valido');

      expect(tokens).toEqual({ accessToken: 'token-assinado', refreshToken: 'token-assinado' });
      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'jti-1' }, data: expect.objectContaining({ status: 'ROTACIONADO' }) }),
      );
    });
  });

  describe('getAccount', () => {
    it('devolve name/email do usuário (GET /auth/me, etapa 18)', async () => {
      const { service, prisma } = buildService();
      prisma.user.findUnique.mockResolvedValue({ name: 'Raphael', email: 'raphael@example.com' });

      const result = await service.getAccount('user-1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { name: true, email: true },
      });
      expect(result).toEqual({ name: 'Raphael', email: 'raphael@example.com' });
    });

    it('lança 404 quando o usuário do token não existe mais', async () => {
      const { service, prisma } = buildService();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getAccount('user-fantasma')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteAccount', () => {
    it('exclui o usuário pelo id (cascade cuida do resto no schema)', async () => {
      const { service, prisma } = buildService();
      prisma.user.delete.mockResolvedValue({});

      await service.deleteAccount('user-1');

      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });
  });
});
