import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import * as Sentry from '@sentry/node';
import { EMAIL_PROVIDER, EmailProvider } from '../email/email-provider.interface';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Etapa 17 (Observabilidade avançada — README raiz §8/17, "alertas"). Job
 * periódico (mesmo padrão `setInterval` + `OnModuleInit`/`OnModuleDestroy`
 * de `SessionService.renewHeartbeats`, sem depender de `@nestjs/schedule`)
 * que varre TODOS os usuários procurando 3 condições operacionais:
 *
 *  1. Sessão caída: `Session.status` ≠ DESCONECTADA (usuário não pediu pra
 *     desconectar) mas `workerHeartbeatAt` parou de ser renovado — o worker
 *     que segurava o socket Baileys provavelmente morreu sem atualizar o
 *     status (ver `SessionService`, comentário sobre não haver reconciliação
 *     automática após restart do processo).
 *  2. Fila travada: `Envio` em PENDENTE sem transicionar há mais tempo que
 *     o esperado — sintoma de um worker de fila (`SendMessageWorker`) parado
 *     ou de um job perdido.
 *  3. Taxa de falha alta: proporção de FALHOU entre os envios concluídos
 *     numa janela recente acima de um limiar, só avaliada com amostra
 *     mínima (evita alerta com 1 de 1 falhou).
 *
 * `User` é a única tabela isenta de RLS (ver schema.prisma) exatamente para
 * permitir este tipo de varredura global sem contornar a política de
 * isolamento por tenant nas outras tabelas: a única forma sancionada de
 * "olhar todo mundo" é listar usuários por aqui e then abrir uma
 * `withTenantContext` por usuário (mesmo padrão já usado em
 * `send-message.worker.ts` para o mesmo dilema) — nunca uma query direta
 * sem contexto de tenant nas tabelas COM RLS (`FORCE ROW LEVEL SECURITY`
 * faz essas queries voltarem 0 linhas silenciosamente, não um erro).
 *
 * Cada condição vira alerta no máximo 1x por `ALERTS_COOLDOWN_MS` (por
 * usuário + tipo) — sem isso, uma condição persistente reenviaria e-mail a
 * cada `ALERTS_CHECK_INTERVAL_MS`.
 */
@Injectable()
export class AlertsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly lastAlertAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.config.get<number>('ALERTS_CHECK_INTERVAL_MS') ?? 60_000;
    this.timer = setInterval(() => void this.runChecks(), intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Exposto para os testes (e para um eventual `POST /admin/alerts/run` de debug futuro) rodarem 1 ciclo sob demanda, sem esperar o timer. */
  async runChecks(): Promise<void> {
    try {
      const users = await this.prisma.user.findMany({ select: { id: true } });
      await Promise.all([
        this.checkSessionsDown(users),
        this.checkStuckQueue(users),
        this.checkFailureRate(users),
      ]);
    } catch (err) {
      this.logger.error({ event: 'alerts_check_failed', err }, 'Falha ao rodar verificação de alertas operacionais.');
    }
  }

  private async checkSessionsDown(users: { id: string }[]): Promise<void> {
    const minutes = this.config.get<number>('ALERT_SESSION_DOWN_MINUTES') ?? 10;
    const staleBefore = new Date(Date.now() - minutes * 60_000);

    for (const { id: userId } of users) {
      const session = await this.prisma.withTenantContext(userId, (tx) => tx.session.findUnique({ where: { userId } }));
      if (!session) continue;

      const shouldBeUp = session.status !== 'DESCONECTADA';
      const heartbeatStale = !session.workerHeartbeatAt || session.workerHeartbeatAt < staleBefore;
      if (shouldBeUp && heartbeatStale) {
        await this.triggerAlert(
          `session_down:${userId}`,
          `Sessão do usuário ${userId} parece caída: status "${session.status}" mas sem heartbeat de worker há mais de ${minutes}min.`,
          { userId, status: session.status, workerHeartbeatAt: session.workerHeartbeatAt },
        );
      }
    }
  }

  private async checkStuckQueue(users: { id: string }[]): Promise<void> {
    const minutes = this.config.get<number>('ALERT_STUCK_QUEUE_MINUTES') ?? 15;
    const staleBefore = new Date(Date.now() - minutes * 60_000);

    for (const { id: userId } of users) {
      const stuckCount = await this.prisma.withTenantContext(userId, (tx) =>
        tx.envio.count({ where: { userId, status: 'PENDENTE', updatedAt: { lt: staleBefore } } }),
      );
      if (stuckCount > 0) {
        await this.triggerAlert(
          `stuck_queue:${userId}`,
          `${stuckCount} envio(s) do usuário ${userId} travado(s) em PENDENTE há mais de ${minutes}min.`,
          { userId, stuckCount },
        );
      }
    }
  }

  private async checkFailureRate(users: { id: string }[]): Promise<void> {
    const windowMinutes = this.config.get<number>('ALERT_FAILURE_RATE_WINDOW_MINUTES') ?? 30;
    const threshold = this.config.get<number>('ALERT_FAILURE_RATE_THRESHOLD') ?? 0.3;
    const minSamples = this.config.get<number>('ALERT_FAILURE_RATE_MIN_SAMPLES') ?? 10;
    const since = new Date(Date.now() - windowMinutes * 60_000);

    for (const { id: userId } of users) {
      const [sent, failed] = await this.prisma.withTenantContext(userId, (tx) =>
        Promise.all([
          tx.envio.count({ where: { userId, status: 'ENVIADO', updatedAt: { gte: since } } }),
          tx.envio.count({ where: { userId, status: 'FALHOU', updatedAt: { gte: since } } }),
        ]),
      );
      const total = sent + failed;
      if (total < minSamples) continue;

      const rate = failed / total;
      if (rate >= threshold) {
        await this.triggerAlert(
          `failure_rate:${userId}`,
          `Taxa de falha de envio do usuário ${userId}: ${(rate * 100).toFixed(0)}% (${failed}/${total}) nos últimos ${windowMinutes}min.`,
          { userId, rate, failed, total },
        );
      }
    }
  }

  /**
   * Loga sempre (`warn`), manda ao Sentry se `SENTRY_DSN` estiver configurado
   * (mesma condição usada por `AllExceptionsFilter`) e envia e-mail se
   * `ALERT_EMAIL_TO` estiver configurado — cada canal falha independente dos
   * outros (falha de e-mail nunca deve impedir o log/Sentry de já terem sido
   * emitidos).
   */
  private async triggerAlert(key: string, message: string, context: Record<string, unknown>): Promise<void> {
    const cooldownMs = this.config.get<number>('ALERTS_COOLDOWN_MS') ?? 30 * 60_000;
    const now = Date.now();
    const last = this.lastAlertAt.get(key);
    if (last !== undefined && now - last < cooldownMs) return;
    this.lastAlertAt.set(key, now);

    this.logger.warn({ event: 'operational_alert', alertKey: key, ...context }, message);

    if (process.env.SENTRY_DSN) {
      Sentry.captureMessage(message, { level: 'warning', tags: { alertKey: key } });
    }

    const to = this.config.get<string>('ALERT_EMAIL_TO');
    if (to) {
      try {
        await this.email.send({ to, subject: `[ZaBot] Alerta operacional — ${key}`, text: message });
      } catch (err) {
        this.logger.error({ event: 'alert_email_failed', alertKey: key, err }, 'Falha ao enviar e-mail de alerta operacional.');
      }
    }
  }
}
