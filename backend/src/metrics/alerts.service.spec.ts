import { AlertsService } from './alerts.service';

/**
 * Testes chamam `runChecks()` diretamente (nunca `onModuleInit`, que só
 * arma o `setInterval` — testá-lo abriria handle assíncrono não fechado no
 * Jest). Prisma mockado com `withTenantContext` chamando `fn(tx)`
 * diretamente, mesmo padrão do resto do backend; `tx` aqui devolve, por
 * padrão, "tudo saudável" (sem sessão caída/fila travada/taxa de falha) —
 * cada teste sobrescreve só o que precisa para disparar (ou não) o alerta
 * em questão.
 */
describe('AlertsService', () => {
  function buildService(env: Record<string, string | number> = {}, users: { id: string }[] = [{ id: 'user-1' }]) {
    const txSession = {
      findUnique: jest.fn(async () => ({ status: 'DESCONECTADA', workerHeartbeatAt: new Date() })),
    };
    const txEnvio = {
      count: jest.fn(async () => 0),
    };
    const tx = { session: txSession, envio: txEnvio };

    const prisma = {
      user: { findMany: jest.fn(async () => users) },
      withTenantContext: jest.fn((_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
    };
    const email = { send: jest.fn(async () => undefined) };
    const config = { get: jest.fn((key: string) => env[key]) };
    const logger = { warn: jest.fn(), error: jest.fn() };

    const service = new AlertsService(prisma as never, email as never, config as never, logger as never);
    return { service, prisma, txSession, txEnvio, email, config, logger };
  }

  describe('checkSessionsDown', () => {
    it('não alerta quando a sessão está DESCONECTADA (usuário pediu para desconectar)', async () => {
      const { service, logger } = buildService();

      await service.runChecks();

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('não alerta quando o status não é DESCONECTADA mas o heartbeat está recente', async () => {
      const { service, txSession, logger } = buildService();
      txSession.findUnique.mockResolvedValueOnce({ status: 'CONECTADA', workerHeartbeatAt: new Date() });

      await service.runChecks();

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('alerta (log + e-mail) quando o status não é DESCONECTADA e o heartbeat está travado', async () => {
      const { service, txSession, logger, email } = buildService({ ALERT_EMAIL_TO: 'ops@zabot.dev' });
      txSession.findUnique.mockResolvedValueOnce({
        status: 'CONECTANDO',
        workerHeartbeatAt: new Date('2000-01-01T00:00:00Z'),
      });

      await service.runChecks();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'operational_alert', alertKey: 'session_down:user-1' }),
        expect.stringContaining('user-1'),
      );
      expect(email.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'ops@zabot.dev', subject: expect.stringContaining('session_down:user-1') }),
      );
    });

    it('alerta também quando workerHeartbeatAt nunca foi setado (null)', async () => {
      const { service, txSession, logger } = buildService();
      txSession.findUnique.mockResolvedValueOnce({ status: 'CONECTADA', workerHeartbeatAt: null });

      await service.runChecks();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ alertKey: 'session_down:user-1' }),
        expect.any(String),
      );
    });

    it('não faz nada quando o usuário não tem Session ainda', async () => {
      const { service, txSession, logger } = buildService();
      txSession.findUnique.mockResolvedValueOnce(null);

      await service.runChecks();

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('checkStuckQueue', () => {
    it('alerta quando há envios travados em PENDENTE além do threshold', async () => {
      const { service, txEnvio, logger } = buildService();
      txEnvio.count.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        where.status === 'PENDENTE' ? 3 : 0,
      );

      await service.runChecks();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ alertKey: 'stuck_queue:user-1', stuckCount: 3 }),
        expect.stringContaining('3 envio'),
      );
    });

    it('não alerta quando não há nenhum envio travado', async () => {
      const { service, logger } = buildService();

      await service.runChecks();

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('checkFailureRate', () => {
    it('alerta quando a taxa de falha ultrapassa o threshold com amostra suficiente', async () => {
      const { service, txEnvio, logger } = buildService({
        ALERT_FAILURE_RATE_THRESHOLD: 0.3,
        ALERT_FAILURE_RATE_MIN_SAMPLES: 10,
      });
      txEnvio.count.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.status === 'ENVIADO') return 6;
        if (where.status === 'FALHOU') return 4;
        return 0;
      });

      await service.runChecks();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ alertKey: 'failure_rate:user-1', failed: 4, total: 10 }),
        expect.any(String),
      );
    });

    it('não alerta quando a amostra é menor que o mínimo, mesmo com 100% de falha', async () => {
      const { service, txEnvio, logger } = buildService({ ALERT_FAILURE_RATE_MIN_SAMPLES: 10 });
      txEnvio.count.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        where.status === 'FALHOU' ? 3 : 0,
      );

      await service.runChecks();

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('não alerta quando a taxa de falha está abaixo do threshold', async () => {
      const { service, txEnvio, logger } = buildService({ ALERT_FAILURE_RATE_THRESHOLD: 0.5 });
      txEnvio.count.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.status === 'ENVIADO') return 9;
        if (where.status === 'FALHOU') return 1;
        return 0;
      });

      await service.runChecks();

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('cooldown', () => {
    it('não repete o mesmo alerta (mesma chave) antes do cooldown expirar', async () => {
      const { service, txSession, email } = buildService({ ALERT_EMAIL_TO: 'ops@zabot.dev', ALERTS_COOLDOWN_MS: 30 * 60_000 });
      txSession.findUnique.mockResolvedValue({ status: 'CONECTADA', workerHeartbeatAt: null });

      await service.runChecks();
      await service.runChecks();

      expect(email.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('resiliência', () => {
    it('loga erro (mas não relança) quando o envio do e-mail de alerta falha', async () => {
      const { service, txSession, email, logger } = buildService({ ALERT_EMAIL_TO: 'ops@zabot.dev' });
      txSession.findUnique.mockResolvedValueOnce({ status: 'CONECTADA', workerHeartbeatAt: null });
      email.send.mockRejectedValueOnce(new Error('smtp indisponível'));

      await expect(service.runChecks()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'alert_email_failed' }),
        expect.any(String),
      );
    });

    it('loga erro (mas não relança) quando a própria varredura falha (ex.: prisma.user.findMany rejeita)', async () => {
      const { service, prisma, logger } = buildService();
      prisma.user.findMany.mockRejectedValueOnce(new Error('db indisponível'));

      await expect(service.runChecks()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'alerts_check_failed' }),
        expect.any(String),
      );
    });
  });
});
