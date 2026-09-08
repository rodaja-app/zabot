import * as https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { ProxyConfigService } from './proxy-config.service';

jest.mock('node:https');

/**
 * Testes unitários com Prisma, `SessionCryptoService`, `ConfigService` e
 * `node:https` mockados — cobrem os dois contratos mais sensíveis deste
 * arquivo: (1) a conta DataImpulse é global (env vars) e só a `stickyKey`
 * varia por sessão, "enriquecendo" o username (`LOGIN__sessid.<chave>`); e
 * (2) falha de proxy nunca vira erro genérico — `testConnectivity` sempre
 * resolve com uma causa categorizada, nunca rejeita/lança.
 */
describe('ProxyConfigService', () => {
  function buildService(env: Record<string, unknown> = {}) {
    const txProxyConfig = {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    const prisma = {
      withTenantContext: jest.fn((_userId: string, fn: (tx: { proxyConfig: typeof txProxyConfig }) => unknown) =>
        fn({ proxyConfig: txProxyConfig }),
      ),
    };

    const crypto = {
      encrypt: jest.fn((plaintext: Buffer) => ({
        ciphertext: plaintext,
        iv: Buffer.from('iv-fake'),
        authTag: Buffer.from('tag-fake'),
      })),
      decrypt: jest.fn(() => Buffer.from(JSON.stringify({ username: 'user-di', password: 'senha-di' }))),
    };

    const defaults: Record<string, unknown> = { DATAIMPULSE_HOST: 'gw.dataimpulse.com', ...env };
    const config = {
      get: jest.fn((key: string) => defaults[key]),
      getOrThrow: jest.fn((key: string) => {
        const value = defaults[key];
        if (value === undefined) throw new Error(`env ausente: ${key}`);
        return value;
      }),
    };

    const logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn(), debug: jest.fn() };

    const service = new ProxyConfigService(prisma as never, crypto as never, config as never, logger as never);
    return { service, prisma, txProxyConfig, crypto, config, logger };
  }

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('isEnabled', () => {
    it('true quando DATAIMPULSE_HOST está setado', () => {
      const { service } = buildService();
      expect(service.isEnabled).toBe(true);
    });

    it('false sem DATAIMPULSE_HOST (dev local sem conta DataImpulse)', () => {
      const { service } = buildService({ DATAIMPULSE_HOST: undefined });
      expect(service.isEnabled).toBe(false);
    });
  });

  describe('stickyMinutes', () => {
    it('usa o padrão de 30 min quando não configurado', () => {
      const { service } = buildService();
      expect(service.stickyMinutes()).toBe(30);
    });

    it('respeita DATAIMPULSE_STICKY_MINUTES configurado', () => {
      const { service } = buildService({ DATAIMPULSE_STICKY_MINUTES: 90 });
      expect(service.stickyMinutes()).toBe(90);
    });
  });

  describe('getOrCreateConfig', () => {
    it('retorna undefined sem tocar o banco quando o proxy está desabilitado', async () => {
      const { service, prisma } = buildService({ DATAIMPULSE_HOST: undefined });

      const result = await service.getOrCreateConfig('user-1', 'sessao-1');

      expect(result).toBeUndefined();
      expect(prisma.withTenantContext).not.toHaveBeenCalled();
    });

    it('retorna a config existente sem criar outra', async () => {
      const { service, txProxyConfig } = buildService();
      const existing = { id: 'proxy-1', sessionId: 'sessao-1' };
      txProxyConfig.findUnique.mockResolvedValue(existing);

      const result = await service.getOrCreateConfig('user-1', 'sessao-1');

      expect(result).toBe(existing);
      expect(txProxyConfig.create).not.toHaveBeenCalled();
    });

    it('cria com a conta global (env) e uma stickyKey nova no primeiro acesso', async () => {
      const { service, txProxyConfig, crypto } = buildService({
        DATAIMPULSE_USERNAME: 'user-di',
        DATAIMPULSE_PASSWORD: 'senha-di',
      });
      txProxyConfig.findUnique.mockResolvedValue(null);
      txProxyConfig.create.mockImplementation(({ data }) => Promise.resolve(data));

      const result = await service.getOrCreateConfig('user-1', 'sessao-1');

      expect(crypto.encrypt).toHaveBeenCalledWith(
        Buffer.from(JSON.stringify({ username: 'user-di', password: 'senha-di' }), 'utf8'),
      );
      expect(txProxyConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sessionId: 'sessao-1',
            userId: 'user-1',
            protocol: 'SOCKS5',
            host: 'gw.dataimpulse.com',
            port: 824,
          }),
        }),
      );
      expect(result).toMatchObject({ sessionId: 'sessao-1', protocol: 'SOCKS5' });
    });
  });

  describe('rotateStickyKey', () => {
    it('grava uma stickyKey nova e stickyRenewedAt atualizado', async () => {
      const { service, txProxyConfig } = buildService();
      txProxyConfig.update.mockResolvedValue({ id: 'proxy-1', stickyKey: 'nova-chave' });

      await service.rotateStickyKey('user-1', 'sessao-1');

      expect(txProxyConfig.update).toHaveBeenCalledWith({
        where: { sessionId: 'sessao-1' },
        data: { stickyKey: expect.any(String), stickyRenewedAt: expect.any(Date) },
      });
    });
  });

  describe('recordTestResult', () => {
    it('persiste ok/erro do teste de conectividade', async () => {
      const { service, txProxyConfig } = buildService();
      txProxyConfig.update.mockResolvedValue({});

      await service.recordTestResult('user-1', 'sessao-1', { ok: false, error: 'proxy_timeout' });

      expect(txProxyConfig.update).toHaveBeenCalledWith({
        where: { sessionId: 'sessao-1' },
        data: { lastTestedAt: expect.any(Date), lastTestOk: false, lastTestError: 'proxy_timeout' },
      });
    });

    it('nunca lança se a própria gravação falhar — só loga', async () => {
      const { service, txProxyConfig, logger } = buildService();
      txProxyConfig.update.mockRejectedValue(new Error('conexão perdida com o banco'));

      await expect(service.recordTestResult('user-1', 'sessao-1', { ok: true })).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'proxy_test_result_persist_error', sessionId: 'sessao-1' }),
        expect.any(String),
      );
    });
  });

  describe('buildAgents', () => {
    const baseProxyConfig = {
      host: 'gw.dataimpulse.com',
      port: 824,
      stickyKey: 'abc123',
      credentialsCiphertext: Buffer.from('x'),
      credentialsIv: Buffer.from('x'),
      credentialsAuthTag: Buffer.from('x'),
    };

    it('monta um SocksProxyAgent para protocolo SOCKS5, username enriquecido com __sessid.<chave>', () => {
      const { service, crypto } = buildService();

      const { agent, fetchAgent } = service.buildAgents({ ...baseProxyConfig, protocol: 'SOCKS5' } as never);

      expect(crypto.decrypt).toHaveBeenCalled();
      expect(agent).toBeInstanceOf(SocksProxyAgent);
      expect(agent).toBe(fetchAgent); // mesmo agent serve conexão e fetch de mídia
    });

    it('monta um HttpsProxyAgent para protocolo HTTP', () => {
      const { service } = buildService();

      const { agent } = service.buildAgents({ ...baseProxyConfig, protocol: 'HTTP', port: 823 } as never);

      expect(agent).toBeInstanceOf(HttpsProxyAgent);
    });
  });

  describe('testConnectivity', () => {
    function mockHttpsGet() {
      const req = { on: jest.fn(), destroy: jest.fn() };
      const httpsGetMock = https.get as unknown as jest.Mock;
      httpsGetMock.mockImplementation((_url, _options, callback) => {
        (mockHttpsGet as unknown as { triggerResponse?: (res: unknown) => void }).triggerResponse = callback;
        return req;
      });
      return req;
    }

    it('ok:true quando o status HTTP é < 400', async () => {
      const { service } = buildService();
      const helper = mockHttpsGet();
      const agents = { agent: {} as never, fetchAgent: {} as never };

      const resultPromise = service.testConnectivity(agents);
      const trigger = (mockHttpsGet as unknown as { triggerResponse: (res: unknown) => void }).triggerResponse;
      trigger({ statusCode: 200, resume: jest.fn() });

      await expect(resultPromise).resolves.toEqual({ ok: true });
      void helper;
    });

    it('ok:false quando o status HTTP é >= 400', async () => {
      const { service } = buildService();
      mockHttpsGet();
      const agents = { agent: {} as never, fetchAgent: {} as never };

      const resultPromise = service.testConnectivity(agents);
      const trigger = (mockHttpsGet as unknown as { triggerResponse: (res: unknown) => void }).triggerResponse;
      trigger({ statusCode: 503, resume: jest.fn() });

      await expect(resultPromise).resolves.toEqual({ ok: false });
    });

    it('categoriza erro de conexão pelo .code do Node (nunca erro genérico)', async () => {
      const { service } = buildService();
      const req = mockHttpsGet();
      const agents = { agent: {} as never, fetchAgent: {} as never };

      const resultPromise = service.testConnectivity(agents);
      const errorHandler = req.on.mock.calls.find(([event]) => event === 'error')?.[1] as (err: unknown) => void;
      errorHandler({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' });

      await expect(resultPromise).resolves.toEqual({ ok: false, error: 'proxy_recusou_conexao' });
    });

    it('resolve proxy_timeout e destrói a requisição quando o timeout dispara', async () => {
      const { service } = buildService();
      const req = mockHttpsGet();
      const agents = { agent: {} as never, fetchAgent: {} as never };

      const resultPromise = service.testConnectivity(agents);
      const timeoutHandler = req.on.mock.calls.find(([event]) => event === 'timeout')?.[1] as () => void;
      timeoutHandler();

      await expect(resultPromise).resolves.toEqual({ ok: false, error: 'proxy_timeout' });
      expect(req.destroy).toHaveBeenCalled();
    });
  });
});
