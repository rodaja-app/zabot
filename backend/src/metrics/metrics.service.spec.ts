import { MetricsService } from './metrics.service';

/**
 * `Registry` próprio por instância (ver comentário do serviço) — cada teste
 * pode instanciar um `MetricsService` novo sem se preocupar em limpar um
 * registry global entre casos.
 */
describe('MetricsService', () => {
  function buildService() {
    return new MetricsService();
  }

  it('expõe os contadores/histograma/gauge no formato Prometheus após registrar eventos', async () => {
    const service = buildService();

    service.recordMessageSent(1.5);
    service.recordMessageFailed();
    service.recordSessionStatus('user-1', 'CONECTADA');

    const output = await service.collect();

    expect(output).toContain('zabot_messages_sent_total 1');
    expect(output).toContain('zabot_messages_failed_total 1');
    expect(output).toContain('zabot_message_send_latency_seconds_sum 1.5');
    expect(output).toContain('zabot_sessions_by_status{status="CONECTADA"} 1');
  });

  it('recordMessageSent nunca observa latência negativa (clamp em 0)', async () => {
    const service = buildService();

    service.recordMessageSent(-5);

    const output = await service.collect();
    expect(output).toContain('zabot_message_send_latency_seconds_sum 0');
  });

  describe('recordSessionStatus — transição de gauge por usuário', () => {
    it('decrementa o status anterior e incrementa o novo quando o status muda', async () => {
      const service = buildService();

      service.recordSessionStatus('user-1', 'CONECTANDO');
      service.recordSessionStatus('user-1', 'CONECTADA');

      const output = await service.collect();
      expect(output).toContain('zabot_sessions_by_status{status="CONECTANDO"} 0');
      expect(output).toContain('zabot_sessions_by_status{status="CONECTADA"} 1');
    });

    it('é no-op quando o status reportado é igual ao último conhecido (evita inc/dec redundante)', async () => {
      const service = buildService();

      service.recordSessionStatus('user-1', 'CONECTADA');
      service.recordSessionStatus('user-1', 'CONECTADA');

      const output = await service.collect();
      expect(output).toContain('zabot_sessions_by_status{status="CONECTADA"} 1');
    });

    it('rastreia por usuário independentemente — 2 usuários CONECTADA soma 2 no gauge', async () => {
      const service = buildService();

      service.recordSessionStatus('user-1', 'CONECTADA');
      service.recordSessionStatus('user-2', 'CONECTADA');

      const output = await service.collect();
      expect(output).toContain('zabot_sessions_by_status{status="CONECTADA"} 2');
    });
  });

  it('contentType espelha o content-type do registry (usado no header de GET /metrics)', () => {
    const service = buildService();
    expect(service.contentType).toContain('text/plain');
  });
});
