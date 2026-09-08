import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { ErrorCategory } from '../common/errors/error-category.enum';
import { PrismaService } from '../prisma/prisma.service';
import { getRedisConnectionOptions } from '../queue/redis-connection';
import { SessionService } from '../whatsapp/session.service';
import { WhatsAppProvider } from '../whatsapp/whatsapp-provider.interface';
import { PhoneNumberService } from './phone-number.service';
import { VALIDATE_NUMBERS_QUEUE, ValidateNumberJobData } from './validate-numbers.queue';

interface VerificationLogEntry {
  timestamp: string;
  candidates: string[];
  matched?: string;
  reason?: string;
}

/**
 * Consumidor da fila `queue:validate-numbers` (README raiz §5/6, etapa 13).
 * Cada job é UMA passada completa de verificação: gera até
 * `CONTACT_MAX_VERIFICATION_ATTEMPTS` candidatos (`PhoneNumberService`) e
 * testa todos em uma única chamada em lote (`WhatsAppProvider.checkNumbers`)
 * — não há "tentar de novo com os mesmos candidatos depois", porque o
 * resultado de existência no WhatsApp não muda sozinho; a única causa de
 * retry automático (via `attempts`/`backoff` da própria fila — ver
 * `ValidateNumbersQueueService`) é a sessão estar desconectada no momento,
 * uma falha de infraestrutura transitória, não do número em si.
 *
 * Idempotente contra jobs duplicados do mesmo contato: um contato já
 * VALIDO nunca é re-testado (é exatamente o "cache do formato validado" do
 * README §5 passo 4).
 */
@Injectable()
export class ValidateNumbersWorker implements OnModuleInit, OnModuleDestroy {
  private worker!: Worker<ValidateNumberJobData>;
  private readonly maxCandidates: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: WhatsAppProvider,
    private readonly phoneNumbers: PhoneNumberService,
    private readonly sessionService: SessionService,
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {
    this.maxCandidates = this.config.get<number>('CONTACT_MAX_VERIFICATION_ATTEMPTS') ?? 3;
  }

  onModuleInit(): void {
    this.worker = new Worker<ValidateNumberJobData>(
      VALIDATE_NUMBERS_QUEUE,
      (job) => this.process(job),
      { connection: getRedisConnectionOptions() },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
  }

  private async process(job: Job<ValidateNumberJobData>): Promise<void> {
    const { contactId, userId } = job.data;

    const contact = await this.prisma.withTenantContext(userId, (tx) =>
      tx.contact.findUnique({ where: { id: contactId } }),
    );
    if (!contact || contact.status === 'VALIDO') return; // removido, ou já validado por outro job — nada a fazer

    const candidates = this.phoneNumbers.generateCandidates(contact.rawPhone, this.maxCandidates);
    const timestamp = new Date().toISOString();

    if (candidates.length === 0) {
      await this.persist(userId, contactId, contact.verificationLog, {
        status: 'INVALIDO',
        normalizedPhone: null,
        failureReason: 'numero_estruturalmente_invalido',
        logEntry: { timestamp, candidates: [], reason: 'numero_estruturalmente_invalido' },
      });
      return;
    }

    const session = await this.sessionService.getOrCreateSession(userId);

    let results: Awaited<ReturnType<WhatsAppProvider['checkNumbers']>>;
    try {
      results = await this.provider.checkNumbers(session.id, candidates);
    } catch (err) {
      if (err instanceof AppError && err.category === ErrorCategory.SESSAO_DESCONECTADA) {
        // Não consome tentativa nem muda o status — não foi de fato checado.
        // Log claro do motivo real; o job falha e a própria fila reagenda
        // com backoff (ver ValidateNumbersQueueService) até a sessão voltar.
        await this.persist(userId, contactId, contact.verificationLog, {
          failureReason: 'sessao_desconectada',
          logEntry: { timestamp, candidates, reason: 'sessao_desconectada' },
          incrementAttempt: false,
        });
        this.logger.warn(
          { event: 'contact_validation_session_offline', contactId, userId },
          'Verificação de contato adiada — sessão WhatsApp não está conectada',
        );
        throw err;
      }

      this.logger.error(
        { event: 'contact_validation_check_error', contactId, userId, err },
        'Falha ao verificar números no WhatsApp para o contato',
      );
      throw err;
    }

    const match = results.find((result) => result.exists);

    if (match) {
      await this.persist(userId, contactId, contact.verificationLog, {
        status: 'VALIDO',
        normalizedPhone: match.candidate,
        failureReason: null,
        logEntry: { timestamp, candidates, matched: match.candidate },
      });
      return;
    }

    await this.persist(userId, contactId, contact.verificationLog, {
      status: 'INVALIDO',
      normalizedPhone: null,
      failureReason: 'nao_encontrado_whatsapp',
      logEntry: { timestamp, candidates, reason: 'nao_encontrado_whatsapp' },
    });
  }

  /** Único ponto de escrita do resultado — acrescenta ao log auditável (nunca sobrescreve o histórico) e só consome uma tentativa quando de fato houve uma checagem real contra o WhatsApp. */
  private async persist(
    userId: string,
    contactId: string,
    currentLog: Prisma.JsonValue,
    changes: {
      status?: 'VALIDO' | 'INVALIDO';
      normalizedPhone?: string | null;
      failureReason: string | null;
      logEntry: VerificationLogEntry;
      incrementAttempt?: boolean;
    },
  ): Promise<void> {
    const log = Array.isArray(currentLog) ? currentLog : [];
    const nextLog = [...log, changes.logEntry] as Prisma.InputJsonValue;
    const incrementAttempt = changes.incrementAttempt ?? true;

    await this.prisma.withTenantContext(userId, (tx) =>
      tx.contact.update({
        where: { id: contactId },
        data: {
          ...(changes.status ? { status: changes.status } : {}),
          ...(changes.normalizedPhone !== undefined ? { normalizedPhone: changes.normalizedPhone } : {}),
          failureReason: changes.failureReason,
          ...(incrementAttempt ? { attempts: { increment: 1 }, lastAttemptAt: new Date() } : {}),
          verificationLog: nextLog,
        },
      }),
    );
  }
}
