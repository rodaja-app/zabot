import { TimezoneService } from './timezone.service';

/**
 * Testes unitários puros (sem I/O) da derivação de fuso por DDD e da janela
 * de horário de envio (README raiz §15) — em especial os casos de borda de
 * `msUntilNextWindow` (já dentro da janela, antes/depois dela no mesmo dia
 * local, e a virada de dia quando o offset do contato empurra a data UTC).
 */
describe('TimezoneService', () => {
  function buildService(env: Record<string, unknown> = {}) {
    const config = { get: jest.fn((key: string) => env[key]) };
    return new TimezoneService(config as never);
  }

  describe('offsetFor', () => {
    it('usa o padrão UTC-3 para DDD fora da tabela (maioria do país)', () => {
      const service = buildService();
      expect(service.offsetFor('5511999998888')).toBe(-3);
    });

    it('usa o offset especial para DDDs do Amazonas/Acre/Rondônia/Roraima/Mato Grosso', () => {
      const service = buildService();
      expect(service.offsetFor('5592999998888')).toBe(-4); // Manaus
      expect(service.offsetFor('5568999998888')).toBe(-5); // Acre
    });

    it('cai no padrão UTC-3 quando o telefone é null/undefined/formato inesperado', () => {
      const service = buildService();
      expect(service.offsetFor(null)).toBe(-3);
      expect(service.offsetFor(undefined)).toBe(-3);
      expect(service.offsetFor('123')).toBe(-3);
    });
  });

  describe('isWithinSendingWindow', () => {
    it('true no meio da janela padrão (8h-20h) no horário local do contato', () => {
      const service = buildService();
      // 15h UTC - 3h (offset padrão) = 12h local.
      const now = new Date('2026-09-07T15:00:00Z');
      expect(service.isWithinSendingWindow('5511999998888', now)).toBe(true);
    });

    it('false antes do início da janela', () => {
      const service = buildService();
      // 10h UTC - 3h = 7h local, antes das 8h.
      const now = new Date('2026-09-07T10:00:00Z');
      expect(service.isWithinSendingWindow('5511999998888', now)).toBe(false);
    });

    it('false depois do fim da janela (limite superior exclusivo)', () => {
      const service = buildService();
      // 23h UTC - 3h = 20h local — janela é [8,20), então 20h já é fora.
      const now = new Date('2026-09-07T23:00:00Z');
      expect(service.isWithinSendingWindow('5511999998888', now)).toBe(false);
    });

    it('respeita janela customizada via env', () => {
      const service = buildService({ SEND_WINDOW_START_HOUR: 9, SEND_WINDOW_END_HOUR: 18 });
      const now = new Date('2026-09-07T11:00:00Z'); // 8h local — antes das 9h customizadas
      expect(service.isWithinSendingWindow('5511999998888', now)).toBe(false);
    });
  });

  describe('msUntilNextWindow', () => {
    it('0 quando já está dentro da janela agora', () => {
      const service = buildService();
      const now = new Date('2026-09-07T15:00:00Z'); // 12h local
      expect(service.msUntilNextWindow('5511999998888', now)).toBe(0);
    });

    it('calcula o delay até 8h local mais tarde no mesmo dia (antes da janela)', () => {
      const service = buildService();
      // 10h UTC = 7h local — faltam 1h para as 8h local = 3600000ms.
      const now = new Date('2026-09-07T10:00:00Z');
      expect(service.msUntilNextWindow('5511999998888', now)).toBe(60 * 60 * 1000);
    });

    it('calcula o delay até 8h local do dia SEGUINTE quando já passou do fim da janela hoje', () => {
      const service = buildService();
      // 23h UTC - 3h = 20h local (fora, é o limite exato) — próxima janela é amanhã 8h local.
      const now = new Date('2026-09-07T23:00:00Z');
      const delayMs = service.msUntilNextWindow('5511999998888', now);
      const expectedNextWindowUtc = new Date('2026-09-08T11:00:00Z').getTime(); // 8h local + 3h offset
      expect(now.getTime() + delayMs).toBe(expectedNextWindowUtc);
    });

    it('nunca retorna negativo mesmo em condições de borda', () => {
      const service = buildService();
      const now = new Date('2026-09-07T11:00:00Z'); // 8h local exatas — já dentro
      expect(service.msUntilNextWindow('5511999998888', now)).toBeGreaterThanOrEqual(0);
    });
  });
});
