import { BadRequestException } from '@nestjs/common';
import { Subject } from 'rxjs';
import { SessionConnectionUpdate } from './whatsapp-provider.interface';
import { SessionService } from './session.service';

/**
 * Testes unitários com todas as dependências mockadas — cobrem as regras
 * mais sensíveis desta etapa: a corrida de sharding entre workers (claim
 * condicional por heartbeat) e a persistência correta dos eventos do
 * provider (`connectionUpdates$` -> Postgres -> `events$`/`statsEvents$`),
 * já que é exatamente aí que um bug silencioso deixaria o status da sessão
 * dessincronizado do socket Baileys de verdade.
 */
describe('SessionService', () => {
  function buildService() {
    const txSession = {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    };
    const prisma = {
      withTenantContext: jest.fn((_userId: string, fn: (tx: { session: typeof txSession }) => unknown) =>
        fn({ session: txSession }),
      ),
    };

    const providerUpdates = new Subject<SessionConnectionUpdate>();
    const provider = {
      connectionUpdates$: providerUpdates.asObservable(),
      startSession: jest.fn(async () => undefined),
      stopSession: jest.fn(async () => undefined),
    };

    const config = { get: jest.fn(() => undefined) };
    const logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn(), debug: jest.fn() };

    const service = new SessionService(prisma as never, provider as never, config as never, logger as never);

    return { service, prisma, txSession, provider, providerUpdates, logger };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getOrCreateSession', () => {
    it('retorna a sessão existente sem criar outra', async () => {
      const { service, txSession } = buildService();
      txSession.findUnique.mockResolvedValue({ id: 'session-1', userId: 'user-1' });

      const session = await service.getOrCreateSession('user-1');

      expect(session).toEqual({ id: 'session-1', userId: 'user-1' });
      expect(txSession.create).not.toHaveBeenCalled();
    });

    it('cria a sessão com os padrões do schema no primeiro acesso', async () => {
      const { service, txSession } = buildService();
      txSession.findUnique.mockResolvedValue(null);
      txSession.create.mockResolvedValue({ id: 'session-novo', userId: 'user-1' });

      const session = await service.getOrCreateSession('user-1');

      expect(txSession.create).toHaveBeenCalledWith({ data: { userId: 'user-1' } });
      expect(session).toEqual({ id: 'session-novo', userId: 'user-1' });
    });
  });

  describe('connect', () => {
    it('reivindica a sessão e inicia o provider quando ninguém mais a segura', async () => {
      const { service, txSession, provider } = buildService();
      txSession.findUnique.mockResolvedValue({ id: 'session-1', userId: 'user-1' });
      txSession.updateMany.mockResolvedValue({ count: 1 });

      await service.connect('user-1', '+55 11 99999-9999');

      expect(txSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'session-1' }) }),
      );
      expect(provider.startSession).toHaveBeenCalledWith({
        sessionId: 'session-1',
        userId: 'user-1',
        phoneNumber: '+55 11 99999-9999',
      });
    });

    it('não inicia o provider quando outro worker já segura a sessão (heartbeat recente)', async () => {
      const { service, txSession, provider, logger } = buildService();
      txSession.findUnique.mockResolvedValue({ id: 'session-1', userId: 'user-1' });
      txSession.updateMany.mockResolvedValue({ count: 0 });

      await service.connect('user-1');

      expect(provider.startSession).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'whatsapp_session_claim_denied' }),
        expect.any(String),
      );
    });
  });

  describe('disconnect', () => {
    it('para o provider, libera a posse e marca DESCONECTADA mesmo sem socket em memória', async () => {
      const { service, txSession, provider } = buildService();
      txSession.findUnique.mockResolvedValue({ id: 'session-1', userId: 'user-1' });
      txSession.updateMany.mockResolvedValue({ count: 1 });

      await service.disconnect('user-1');

      expect(provider.stopSession).toHaveBeenCalledWith('session-1');
      expect(txSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          data: expect.objectContaining({ status: 'DESCONECTADA', workerId: null }),
        }),
      );
    });
  });

  describe('rename', () => {
    it('rejeita nome vazio (ou só espaços) sem chamar o banco', async () => {
      const { service, txSession } = buildService();

      await expect(service.rename('user-1', '   ')).rejects.toBeInstanceOf(BadRequestException);
      expect(txSession.update).not.toHaveBeenCalled();
    });

    it('grava o nome já sem espaços nas pontas', async () => {
      const { service, txSession } = buildService();
      txSession.findUnique.mockResolvedValue({ id: 'session-1', userId: 'user-1' });
      txSession.update.mockResolvedValue({ id: 'session-1', name: 'Empresa X' });

      await service.rename('user-1', '  Empresa X  ');

      expect(txSession.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: { name: 'Empresa X' },
      });
    });
  });

  describe('eventos do provider', () => {
    it('persiste status/telefone e re-emite em events$ só para sessões que este worker possui', async () => {
      const { service, txSession, provider, providerUpdates } = buildService();
      txSession.findUnique.mockResolvedValue({ id: 'session-1', userId: 'user-1' });
      txSession.updateMany.mockResolvedValue({ count: 1 });
      service.onModuleInit();

      const received: unknown[] = [];
      service.events$.subscribe((event) => received.push(event));

      await service.connect('user-1');
      providerUpdates.next({ sessionId: 'session-1', status: 'CONECTADA', phoneNumber: '5511999999999' });
      await flushMicrotasks();

      expect(txSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          data: expect.objectContaining({ status: 'CONECTADA', phoneNumber: '5511999999999' }),
        }),
      );
      expect(received).toContainEqual(
        expect.objectContaining({ userId: 'user-1', sessionId: 'session-1', status: 'CONECTADA' }),
      );
      void provider;
    });

    it('ignora eventos de sessões que este worker não possui (nunca conectou ou já desconectou)', async () => {
      const { service, txSession, providerUpdates } = buildService();
      service.onModuleInit();

      const received: unknown[] = [];
      service.events$.subscribe((event) => received.push(event));

      providerUpdates.next({ sessionId: 'sessao-de-outro-worker', status: 'CONECTADA' });
      await flushMicrotasks();

      expect(txSession.update).not.toHaveBeenCalled();
      expect(received).toHaveLength(0);
    });

    it('em logout definitivo, libera a posse (workerId) e para de rastrear a sessão', async () => {
      const { service, txSession, providerUpdates } = buildService();
      txSession.findUnique.mockResolvedValue({ id: 'session-1', userId: 'user-1' });
      txSession.updateMany.mockResolvedValue({ count: 1 });
      service.onModuleInit();

      await service.connect('user-1');
      txSession.updateMany.mockClear();

      providerUpdates.next({
        sessionId: 'session-1',
        status: 'DESCONECTADA',
        disconnectReason: 'logout_definitivo',
        loggedOut: true,
      });
      await flushMicrotasks();

      expect(txSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-1', workerId: expect.any(String) },
          data: { workerId: null, workerHeartbeatAt: null },
        }),
      );
    });
  });

  describe('publishStats', () => {
    it('repassa o snapshot de estatísticas em statsEvents$', () => {
      const { service } = buildService();
      const received: unknown[] = [];
      service.statsEvents$.subscribe((event) => received.push(event));

      service.publishStats('user-1', { contactsImported: 10, messagesSent: 5, messagesPending: 2, failures: 1 });

      expect(received).toEqual([
        { userId: 'user-1', contactsImported: 10, messagesSent: 5, messagesPending: 2, failures: 1 },
      ]);
    });
  });
});

/** Deixa as microtasks (promises encadeadas no subscribe do RxJS) resolverem antes das asserções. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
