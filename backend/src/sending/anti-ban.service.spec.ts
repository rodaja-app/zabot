import { AntiBanService } from './anti-ban.service';

/**
 * Testes unitários puros (sem I/O) de `AntiBanService.computeDelayMs`
 * (README raiz §15 — jitter humano + rampa de aquecimento). `Math.random()`
 * é mockado para tornar os bounds [min, max] determinísticos: random=0
 * sempre cai no mínimo do bound escolhido, random~1 sempre cai (perto) no
 * máximo — sem isso o teste teria que aceitar qualquer valor no intervalo,
 * o que não pegaria um bound trocado por engano.
 */
describe('AntiBanService', () => {
  function buildService(env: Record<string, unknown> = {}) {
    const config = { get: jest.fn((key: string) => env[key]) };
    return new AntiBanService(config as never);
  }

  function mockRandom(value: number) {
    return jest.spyOn(Math, 'random').mockReturnValue(value);
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('rampa de aquecimento (sessão com menos de SEND_WARMUP_DAYS)', () => {
    it('usa o mínimo de aquecimento (20s padrão) quando random=0', () => {
      const service = buildService();
      mockRandom(0);
      const createdAt = new Date('2026-09-07T00:00:00Z');
      const now = new Date('2026-09-07T12:00:00Z'); // 0.5 dia de idade, < 3 dias
      expect(service.computeDelayMs(createdAt, now)).toBe(20_000);
    });

    it('usa o máximo de aquecimento (45s padrão) quando random~1', () => {
      const service = buildService();
      mockRandom(0.999999);
      const createdAt = new Date('2026-09-07T00:00:00Z');
      const now = new Date('2026-09-07T12:00:00Z');
      const delay = service.computeDelayMs(createdAt, now);
      expect(delay).toBeGreaterThanOrEqual(44_999);
      expect(delay).toBeLessThanOrEqual(45_000);
    });

    it('ainda está em aquecimento exatamente no limite inferior de idade (ageDays < warmupDays)', () => {
      const service = buildService();
      mockRandom(0);
      const createdAt = new Date('2026-09-01T00:00:00Z');
      const now = new Date('2026-09-03T23:00:00Z'); // ~2.96 dias, < 3
      expect(service.computeDelayMs(createdAt, now)).toBe(20_000);
    });
  });

  describe('sessão madura (idade >= SEND_WARMUP_DAYS)', () => {
    it('usa o mínimo maduro (4s padrão) quando random=0', () => {
      const service = buildService();
      mockRandom(0);
      const createdAt = new Date('2026-09-01T00:00:00Z');
      const now = new Date('2026-09-07T00:00:00Z'); // 6 dias, >= 3
      expect(service.computeDelayMs(createdAt, now)).toBe(4_000);
    });

    it('usa o máximo maduro (12s padrão) quando random~1', () => {
      const service = buildService();
      mockRandom(0.999999);
      const createdAt = new Date('2026-09-01T00:00:00Z');
      const now = new Date('2026-09-07T00:00:00Z');
      const delay = service.computeDelayMs(createdAt, now);
      expect(delay).toBeGreaterThanOrEqual(11_999);
      expect(delay).toBeLessThanOrEqual(12_000);
    });

    it('transiciona para maduro exatamente quando ageDays === warmupDays', () => {
      const service = buildService();
      mockRandom(0);
      const createdAt = new Date('2026-09-01T00:00:00Z');
      const now = new Date('2026-09-04T00:00:00Z'); // exatamente 3 dias
      expect(service.computeDelayMs(createdAt, now)).toBe(4_000);
    });
  });

  describe('overrides via env', () => {
    it('respeita bounds e warmupDays customizados', () => {
      const service = buildService({
        SEND_WARMUP_DAYS: 1,
        SEND_WARMUP_MIN_DELAY_MS: 1_000,
        SEND_WARMUP_MAX_DELAY_MS: 2_000,
        SEND_MATURE_MIN_DELAY_MS: 100,
        SEND_MATURE_MAX_DELAY_MS: 200,
      });
      mockRandom(0);
      const createdAt = new Date('2026-09-07T00:00:00Z');

      const stillWarming = new Date('2026-09-07T12:00:00Z'); // 0.5 dia, < 1
      expect(service.computeDelayMs(createdAt, stillWarming)).toBe(1_000);

      const alreadyMature = new Date('2026-09-08T12:00:00Z'); // 1.5 dia, >= 1
      expect(service.computeDelayMs(createdAt, alreadyMature)).toBe(100);
    });
  });

  it('nunca retorna negativo, mesmo com sessão criada no futuro (idade negativa)', () => {
    const service = buildService();
    mockRandom(0.5);
    const createdAt = new Date('2026-09-10T00:00:00Z');
    const now = new Date('2026-09-07T00:00:00Z'); // "criada" depois de "agora"
    expect(service.computeDelayMs(createdAt, now)).toBeGreaterThanOrEqual(0);
  });
});
