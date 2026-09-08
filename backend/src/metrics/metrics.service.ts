import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { SessionRuntimeStatus } from '../whatsapp/whatsapp-provider.interface';

/**
 * Etapa 17 (Observabilidade avançada — README raiz §17, "métricas
 * Grafana/Prometheus"). Módulo `@Global()` (ver `metrics.module.ts`) —
 * injetável em qualquer serviço sem reimportar o módulo, mesmo padrão de
 * `EmailModule`/`EMAIL_PROVIDER`.
 *
 * `Registry` próprio (não o `register` default do `prom-client`) para não
 * vazar métricas entre instâncias em teste (cada `new MetricsService()` nos
 * specs começa com um registry limpo, sem precisar de `register.clear()`
 * manual).
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private readonly messagesSentTotal = new Counter({
    name: 'zabot_messages_sent_total',
    help: 'Total de mensagens enviadas com sucesso (Envio.status = ENVIADO).',
    registers: [this.registry],
  });

  private readonly messagesFailedTotal = new Counter({
    name: 'zabot_messages_failed_total',
    help: 'Total de mensagens que falharam definitivamente (Envio.status = FALHOU).',
    registers: [this.registry],
  });

  private readonly messageSendLatencySeconds = new Histogram({
    name: 'zabot_message_send_latency_seconds',
    help: 'Tempo (segundos) entre a criação do Envio e a confirmação de envio.',
    buckets: [0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300],
    registers: [this.registry],
  });

  private readonly sessionsByStatus = new Gauge({
    name: 'zabot_sessions_by_status',
    help: 'Número de sessões WhatsApp atualmente em cada status de conexão.',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });

  /**
   * Último status conhecido por usuário — necessário porque `Gauge` não tem
   * "mover" um label para outro, só inc/dec: para refletir uma transição de
   * status (ex.: CONECTANDO → CONECTADA) é preciso decrementar o label
   * antigo e incrementar o novo. Em memória (não Redis/DB) porque cada
   * processo só precisa saber sobre as sessões que ELE está reportando —
   * mesma razão de `SessionService`'s sharding registry ser local ao worker.
   */
  private readonly lastStatusByUserId = new Map<string, SessionRuntimeStatus>();

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'zabot_process_' });
  }

  recordMessageSent(latencySeconds: number): void {
    this.messagesSentTotal.inc();
    this.messageSendLatencySeconds.observe(Math.max(0, latencySeconds));
  }

  recordMessageFailed(): void {
    this.messagesFailedTotal.inc();
  }

  recordSessionStatus(userId: string, status: SessionRuntimeStatus): void {
    const previous = this.lastStatusByUserId.get(userId);
    if (previous === status) return;

    if (previous) {
      this.sessionsByStatus.dec({ status: previous });
    }
    this.sessionsByStatus.inc({ status });
    this.lastStatusByUserId.set(userId, status);
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  async collect(): Promise<string> {
    return this.registry.metrics();
  }
}
