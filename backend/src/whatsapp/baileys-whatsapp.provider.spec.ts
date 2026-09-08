jest.mock('@whiskeysockets/baileys', () => {
  const actual = jest.requireActual('@whiskeysockets/baileys');
  return {
    ...actual,
    __esModule: true,
    default: jest.fn(),
    fetchLatestBaileysVersion: jest.fn(async () => ({ version: [2, 3000, 0] })),
  };
});

jest.mock('./db-auth-state', () => ({
  useDbAuthState: jest.fn(async () => ({ state: { creds: { registered: true } }, saveCreds: jest.fn() })),
  clearAuthState: jest.fn(async () => undefined),
}));

import makeWASocketImport from '@whiskeysockets/baileys';
import { SessionNotConnectedError } from '../common/errors/app-error';
import { BaileysWhatsAppProvider } from './baileys-whatsapp.provider';

const makeWASocket = makeWASocketImport as unknown as jest.Mock;

/**
 * Testes unitários com Baileys, `db-auth-state` e `ProxyConfigService`
 * mockados — cobrem o contrato mais sensível da Etapa 12: proxy indisponível
 * nunca abre socket (é tratado como falha de conexão, com reconexão via o
 * mesmo backoff já existente), e a renovação de sticky session é um ciclo de
 * reconexão controlado (nunca logout) agendado com a folga configurada.
 */
describe('BaileysWhatsAppProvider — proxy (Etapa 12)', () => {
  function buildProvider(proxyOverrides: Record<string, unknown> = {}) {
    const prisma = {};
    const sessionCrypto = {};
    const proxyConfigService = {
      getOrCreateConfig: jest.fn(async () => undefined),
      buildAgents: jest.fn(() => ({ agent: {}, fetchAgent: {} })),
      testConnectivity: jest.fn(async () => ({ ok: true })),
      recordTestResult: jest.fn(async () => undefined),
      stickyMinutes: jest.fn(() => 30),
      rotateStickyKey: jest.fn(async () => ({})),
      ...proxyOverrides,
    };
    const logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn(), debug: jest.fn() };

    const provider = new BaileysWhatsAppProvider(
      prisma as never,
      sessionCrypto as never,
      proxyConfigService as never,
      logger as never,
    );
    return { provider, proxyConfigService, logger };
  }

  function fakeSocket() {
    return {
      ev: { on: jest.fn() },
      end: jest.fn(),
      logout: jest.fn(async () => undefined),
      user: undefined,
      onWhatsApp: jest.fn(async () => []),
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    makeWASocket.mockReset();
    makeWASocket.mockImplementation(() => fakeSocket());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('abre o socket sem agent/fetchAgent quando o proxy está desabilitado no ambiente', async () => {
    const { provider, proxyConfigService } = buildProvider({ getOrCreateConfig: jest.fn(async () => undefined) });

    await provider.startSession({ sessionId: 'sessao-1', userId: 'user-1' });

    expect(proxyConfigService.testConnectivity).not.toHaveBeenCalled();
    expect(makeWASocket).toHaveBeenCalledTimes(1);
    expect(makeWASocket.mock.calls[0][0]).not.toHaveProperty('agent');
  });

  it('nunca abre socket quando o teste de conectividade do proxy falha — agenda reconexão com a causa categorizada', async () => {
    const received: unknown[] = [];
    const { provider, proxyConfigService } = buildProvider({
      getOrCreateConfig: jest.fn(async () => ({ id: 'proxy-1' })),
      testConnectivity: jest.fn(async () => ({ ok: false, error: 'proxy_timeout' })),
    });
    provider.connectionUpdates$.subscribe((update) => received.push(update));

    await provider.startSession({ sessionId: 'sessao-1', userId: 'user-1' });

    expect(makeWASocket).not.toHaveBeenCalled();
    expect(proxyConfigService.recordTestResult).toHaveBeenCalledWith('user-1', 'sessao-1', {
      ok: false,
      error: 'proxy_timeout',
    });
    expect(received).toContainEqual(
      expect.objectContaining({ sessionId: 'sessao-1', status: 'CONECTANDO', disconnectReason: 'proxy_timeout' }),
    );

    // backoff do primeiro retry: BASE_RECONNECT_DELAY_MS * 2^1 = 2000ms
    await jest.advanceTimersByTimeAsync(2_000);
    expect(proxyConfigService.getOrCreateConfig).toHaveBeenCalledTimes(2);
  });

  it('agenda a renovação da sticky key com a folga configurada e reabre o socket sem logout', async () => {
    const { provider, proxyConfigService } = buildProvider({
      getOrCreateConfig: jest.fn(async () => ({ id: 'proxy-1', stickyKey: 'chave-antiga' })),
      stickyMinutes: jest.fn(() => 30),
    });

    await provider.startSession({ sessionId: 'sessao-1', userId: 'user-1' });
    expect(makeWASocket).toHaveBeenCalledTimes(1);
    const firstSocket = makeWASocket.mock.results[0].value as ReturnType<typeof fakeSocket>;

    // folga de 2 min antes do limite de 30 min => renova aos 28 min
    await jest.advanceTimersByTimeAsync(28 * 60_000);

    expect(proxyConfigService.rotateStickyKey).toHaveBeenCalledWith('user-1', 'sessao-1');
    expect(firstSocket.logout).not.toHaveBeenCalled();
    expect(firstSocket.end).toHaveBeenCalledWith(undefined);
    expect(makeWASocket).toHaveBeenCalledTimes(2);
  });

  it('nunca agenda renovação abaixo do piso de segurança (30s), mesmo com sticky muito curto', async () => {
    const { provider, proxyConfigService } = buildProvider({
      getOrCreateConfig: jest.fn(async () => ({ id: 'proxy-1', stickyKey: 'chave-antiga' })),
      stickyMinutes: jest.fn(() => 1), // 1 min configurado, folga de 2 min deixaria negativo sem o piso
    });

    await provider.startSession({ sessionId: 'sessao-1', userId: 'user-1' });

    await jest.advanceTimersByTimeAsync(29_000);
    expect(proxyConfigService.rotateStickyKey).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(2_000);
    expect(proxyConfigService.rotateStickyKey).toHaveBeenCalled();
  });
});

/**
 * Testes de `checkNumbers` (Etapa 13, README raiz §5 passo 3) — cobrem a
 * parte mais sensível: a API do Baileys pode omitir do array de retorno os
 * JIDs que não existem, então o resultado precisa ser montado a partir do
 * conjunto do que *veio* com `exists: true`, nunca assumindo posição/ordem
 * paralela ao array de candidatos de entrada.
 */
describe('BaileysWhatsAppProvider — checkNumbers (Etapa 13)', () => {
  function buildProvider() {
    const prisma = {};
    const sessionCrypto = {};
    const proxyConfigService = {
      getOrCreateConfig: jest.fn(async () => undefined),
      buildAgents: jest.fn(() => ({ agent: {}, fetchAgent: {} })),
      testConnectivity: jest.fn(async () => ({ ok: true })),
      recordTestResult: jest.fn(async () => undefined),
      stickyMinutes: jest.fn(() => 30),
      rotateStickyKey: jest.fn(async () => ({})),
    };
    const logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn(), debug: jest.fn() };

    const provider = new BaileysWhatsAppProvider(
      prisma as never,
      sessionCrypto as never,
      proxyConfigService as never,
      logger as never,
    );
    return { provider };
  }

  function fakeSocket() {
    return {
      ev: { on: jest.fn() },
      end: jest.fn(),
      logout: jest.fn(async () => undefined),
      user: undefined,
      onWhatsApp: jest.fn(async () => []),
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    makeWASocket.mockReset();
    makeWASocket.mockImplementation(() => fakeSocket());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('lança SessionNotConnectedError quando não há socket ativo para a sessão', async () => {
    const { provider } = buildProvider();

    await expect(provider.checkNumbers('sessao-inexistente', ['5511999998888'])).rejects.toBeInstanceOf(
      SessionNotConnectedError,
    );
  });

  it('retorna [] sem chamar onWhatsApp quando não há candidatos', async () => {
    const { provider } = buildProvider();
    await provider.startSession({ sessionId: 'sessao-1', userId: 'user-1' });
    const socket = makeWASocket.mock.results[0].value as ReturnType<typeof fakeSocket>;

    const result = await provider.checkNumbers('sessao-1', []);

    expect(result).toEqual([]);
    expect(socket.onWhatsApp).not.toHaveBeenCalled();
  });

  it('marca exists:true só para os candidatos que voltaram no array do Baileys (que pode omitir os inexistentes)', async () => {
    const { provider } = buildProvider();
    await provider.startSession({ sessionId: 'sessao-1', userId: 'user-1' });
    const socket = makeWASocket.mock.results[0].value as ReturnType<typeof fakeSocket>;
    socket.onWhatsApp.mockResolvedValue([{ jid: '5511999998888:12@s.whatsapp.net', exists: true }]);

    const result = await provider.checkNumbers('sessao-1', ['5511999998888', '551199998888']);

    expect(socket.onWhatsApp).toHaveBeenCalledWith('5511999998888@s.whatsapp.net', '551199998888@s.whatsapp.net');
    expect(result).toEqual([
      { candidate: '5511999998888', exists: true },
      { candidate: '551199998888', exists: false },
    ]);
  });
});
