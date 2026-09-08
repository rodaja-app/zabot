import { Injectable, Inject } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { CampaignMediaType, CampaignStatus, Prisma } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { ErrorCategory } from '../common/errors/error-category.enum';
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from '../campaigns/media-storage-provider.interface';
import { PersonalizationService } from '../campaigns/personalization.service';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { OutgoingMedia, WhatsAppProvider } from '../whatsapp/whatsapp-provider.interface';
import { SessionGateway } from '../whatsapp/session.gateway';
import { SessionService } from '../whatsapp/session.service';
import { AntiBanService } from './anti-ban.service';
import { DeadLetterQueueService } from './dead-letter.queue';
import { SendMessageJobData, SendMessageQueueService } from './send-message.queue';
import { TimezoneService } from './timezone.service';

/** Extensão de arquivo aproximada a partir do mimetype — `CampaignMedia` não guarda o nome original (gap da etapa 14, ver backend/README.md), então o nome exibido no WhatsApp para DOCUMENTO é sempre gerado. */
function guessExtension(mimeType: string): string {
  const subtype = mimeType.split('/')[1]?.split('+')[0] ?? 'bin';
  return subtype.replace(/^x-/, '').slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Etapa 15 — o "worker de verdade" por trás de `SendMessageWorker`
 * (extraído para uma classe injetável simples, sem nenhuma dependência de
 * BullMQ, exatamente para poder ser testado com Prisma/provider mockados,
 * mesmo padrão de `CampaignsService`/`MediaService`).
 *
 * `process()` cobre 1 tentativa de 1 `Envio`:
 *  1. Idempotência: `Envio` que não está mais PENDENTE (job duplicado, ou já
 *     resolvido por outro caminho) não faz nada.
 *  2. Janela de horário do contato (README §15): fora da janela, reagenda
 *     via `SendMessageQueueService.reschedule` e retorna — NÃO conta como
 *     tentativa (nunca chegou a tentar enviar de verdade).
 *  3. Delay humano/jitter (`AntiBanService`) — só então.
 *  4. Personalização (`PersonalizationService`) + mídia (só na mensagem de
 *     `order === 0` de cada destinatário — decisão de design documentada em
 *     backend/README.md "Etapa 15": mídia é por CAMPANHA, não por mensagem).
 *  5. `WhatsAppProvider.sendMessage`. Sucesso e falha de tentativa (ainda
 *     não definitiva) são persistidos aqui; a transição TERMINAL de falha
 *     (depois de esgotadas as tentativas do BullMQ) é responsabilidade de
 *     `finalizeFailure`, chamado pelo `SendMessageWorker` a partir do
 *     listener `failed` do `Worker` — só ele sabe quantas tentativas o job
 *     já teve.
 *
 * Etapa 17 (Observabilidade avançada): `markSent`/`finalizeFailure` também
 * alimentam `MetricsService` (contadores `zabot_messages_sent_total`/
 * `zabot_messages_failed_total` e o histograma de latência) — nos mesmos
 * pontos que já são a fonte de verdade do status terminal do `Envio`, para
 * a métrica nunca divergir do dado persistido.
 */
@Injectable()
export class SendMessageProcessorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: WhatsAppProvider,
    private readonly sessionService: SessionService,
    private readonly personalization: PersonalizationService,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly storage: MediaStorageProvider,
    private readonly antiBan: AntiBanService,
    private readonly timezone: TimezoneService,
    private readonly sendQueue: SendMessageQueueService,
    private readonly deadLetter: DeadLetterQueueService,
    private readonly logger: Logger,
    private readonly metrics: MetricsService,
    private readonly sessionGateway: SessionGateway,
  ) {}

  async process(data: SendMessageJobData): Promise<void> {
    const { envioId, userId, sessionId } = data;

    const envio = await this.prisma.withTenantContext(userId, (tx) =>
      tx.envio.findUnique({
        where: { id: envioId },
        include: { campaign: true, message: true, recipient: { include: { contact: true } } },
      }),
    );
    if (!envio || envio.status !== 'PENDENTE') return; // já resolvido — nada a fazer

    const { contact } = envio.recipient;
    const now = new Date();

    if (!this.timezone.isWithinSendingWindow(contact.normalizedPhone, now)) {
      const delayMs = this.timezone.msUntilNextWindow(contact.normalizedPhone, now);
      await this.sendQueue.reschedule(sessionId, data, delayMs);
      return;
    }

    const session = await this.sessionService.getOrCreateSession(userId);
    await sleep(this.antiBan.computeDelayMs(session.createdAt, now));

    const customFields = (contact.customFields as Record<string, string> | null) ?? {};
    const text = this.personalization.render(envio.message.text, customFields);
    const media =
      envio.message.order === 0 ? await this.loadMedia(userId, envio.campaign.id, envio.campaign.mediaType) : undefined;

    try {
      if (!contact.normalizedPhone) {
        throw new AppError('Destinatário sem número normalizado — não deveria estar VALIDO sem isso.', ErrorCategory.VALIDACAO, {
          contactId: contact.id,
        });
      }
      await this.provider.sendMessage(sessionId, { to: contact.normalizedPhone, text, media });
      await this.markSent(userId, envio.id, envio.recipientId, envio.campaign.id, envio.createdAt);
    } catch (err) {
      const reason = err instanceof AppError ? err.category : ErrorCategory.DESCONHECIDO;
      this.logger.error(
        { event: 'send_message_attempt_error', envioId, userId, sessionId, reason, err },
        'Falha ao enviar mensagem da campanha (tentativa registrada, fila decide retry/desistência)',
      );
      await this.prisma.withTenantContext(userId, (tx) =>
        tx.envio.update({ where: { id: envio.id }, data: { attempts: { increment: 1 }, failureReason: reason } }),
      );
      throw err;
    }
  }

  /**
   * Chamado pelo `SendMessageWorker` só quando o BullMQ esgotou as
   * tentativas do job (falha definitiva) — transição terminal de
   * `CampaignRecipient` (README raiz §7: "FALHOU nunca reverte") + contador
   * agregado `Session.failures`, e registro na fila `queue:dead-letter`
   * para análise. Idempotente: se o `Envio` já estiver FALHOU (ex.: listener
   * disparado mais de uma vez), não repete o rollup nem o push.
   */
  async finalizeFailure(data: SendMessageJobData, attemptsMade: number, lastError: unknown): Promise<void> {
    const { envioId, userId, sessionId } = data;

    const envio = await this.prisma.withTenantContext(userId, (tx) =>
      tx.envio.findUnique({ where: { id: envioId } }),
    );
    if (!envio || envio.status === 'FALHOU') return;

    const reason = envio.failureReason ?? (lastError instanceof AppError ? lastError.category : ErrorCategory.DESCONHECIDO);

    await this.prisma.withTenantContext(userId, (tx) =>
      tx.envio.update({ where: { id: envioId }, data: { status: 'FALHOU', failureReason: reason } }),
    );
    await this.applyRecipientOutcome(userId, envio.recipientId, envio.campaignId, 'FALHOU');

    const updated = await this.prisma.withTenantContext(userId, (tx) =>
      tx.session.update({ where: { userId }, data: { failures: { increment: 1 }, messagesPending: { decrement: 1 } } }),
    );
    this.sessionService.publishStats(userId, {
      contactsImported: updated.contactsImported,
      messagesSent: updated.messagesSent,
      messagesPending: updated.messagesPending,
      failures: updated.failures,
    });

    await this.deadLetter.push({ envioId, campaignId: envio.campaignId, userId, sessionId, reason, attemptsMade });
    this.metrics.recordMessageFailed();
  }

  private async markSent(
    userId: string,
    envioId: string,
    recipientId: string,
    campaignId: string,
    createdAt: Date,
  ): Promise<void> {
    const sentAt = new Date();
    await this.prisma.withTenantContext(userId, (tx) =>
      tx.envio.update({
        where: { id: envioId },
        data: { status: 'ENVIADO', sentAt, attempts: { increment: 1 }, failureReason: null },
      }),
    );
    this.metrics.recordMessageSent((sentAt.getTime() - createdAt.getTime()) / 1000);
    await this.applyRecipientOutcome(userId, recipientId, campaignId, 'ENVIADO');

    const updated = await this.prisma.withTenantContext(userId, (tx) =>
      tx.session.update({ where: { userId }, data: { messagesSent: { increment: 1 }, messagesPending: { decrement: 1 } } }),
    );
    this.sessionService.publishStats(userId, {
      contactsImported: updated.contactsImported,
      messagesSent: updated.messagesSent,
      messagesPending: updated.messagesPending,
      failures: updated.failures,
    });
  }

  /**
   * Recalcula `CampaignRecipient.status` a partir de TODOS os `Envio`s
   * irmãos (README raiz §7): FALHOU é terminal e nunca reverte — se o
   * destinatário já estiver FALHOU, um envio ENVIADO posterior (outra
   * mensagem da mesma campanha que ainda estava em voo) não muda nada; só
   * incrementa `Campaign.sentCount/failedCount` (unidade de CONTATO, nunca
   * de `Envio`) na transição real de PENDENTE → ENVIADO/FALHOU, exatamente
   * uma vez por destinatário.
   *
   * Correção descoberta na etapa 18 (integração final): antes desta etapa
   * `Campaign.status` só era setado na criação (`CampaignsService`, PENDENTE
   * ou ENVIADA se já nascesse sem destinatário) e nunca transicionava para
   * ENVIADA quando o envio de verdade terminava — o mock (`MockMessageRepository`,
   * timer local) sempre fazia essa transição, então sem isso o front real
   * nunca veria uma campanha em andamento chegar a "concluída". `pendingCount`
   * chegar a 0 é o mesmo critério que o mock usa.
   */
  private async applyRecipientOutcome(
    userId: string,
    recipientId: string,
    campaignId: string,
    outcome: 'ENVIADO' | 'FALHOU',
  ): Promise<void> {
    const progress = await this.prisma.withTenantContext(userId, async (tx) => {
      const recipient = await tx.campaignRecipient.findUnique({ where: { id: recipientId } });
      if (!recipient || recipient.status === 'FALHOU') return null; // terminal — nunca reverte

      if (outcome === 'FALHOU') {
        await tx.campaignRecipient.update({ where: { id: recipientId }, data: { status: 'FALHOU' } });
        const campaign = await tx.campaign.update({
          where: { id: campaignId },
          data: { pendingCount: { decrement: 1 }, failedCount: { increment: 1 } },
        });
        return this.markDoneIfFinished(tx, campaign);
      }

      const siblings = await tx.envio.findMany({ where: { recipientId }, select: { status: true } });
      const allEnvioSent = siblings.every((e) => e.status === 'ENVIADO');
      if (!allEnvioSent) return null; // ainda tem mensagem pendente deste destinatário — status continua PENDENTE

      await tx.campaignRecipient.update({ where: { id: recipientId }, data: { status: 'ENVIADO' } });
      const campaign = await tx.campaign.update({
        where: { id: campaignId },
        data: { pendingCount: { decrement: 1 }, sentCount: { increment: 1 } },
      });
      return this.markDoneIfFinished(tx, campaign);
    });

    // Emissão FORA da transação (só depois do commit) — ver doc de `emitCampaignProgress`.
    if (progress) this.emitCampaignProgress(userId, progress);
  }

  /** Promove `Campaign.status` para ENVIADA quando o `pendingCount` zera — ver comentário de `applyRecipientOutcome` acima. */
  private async markDoneIfFinished(
    tx: Prisma.TransactionClient,
    campaign: { id: string; status: CampaignStatus; pendingCount: number; sentCount: number; failedCount: number },
  ): Promise<{ id: string; status: CampaignStatus; pendingCount: number; sentCount: number; failedCount: number }> {
    if (campaign.pendingCount > 0 || campaign.status === 'ENVIADA') return campaign;
    return tx.campaign.update({ where: { id: campaign.id }, data: { status: 'ENVIADA' } });
  }

  /**
   * Etapa 18 — publica o delta de progresso assim que a transação acima
   * commita a mudança real de contador (nunca antes, para o evento nunca
   * anunciar um estado que não foi persistido). Campanha some do
   * `pendingCount` só quando chega a 0 — o front decide status "concluída"
   * a partir disso, mesmo cálculo que `Campaign.status` já usa.
   */
  private emitCampaignProgress(
    userId: string,
    campaign: { id: string; status: CampaignStatus; sentCount: number; pendingCount: number; failedCount: number },
  ): void {
    this.sessionGateway.emitCampaignProgress(userId, {
      id: campaign.id,
      status: campaign.status,
      sentCount: campaign.sentCount,
      pendingCount: campaign.pendingCount,
      failedCount: campaign.failedCount,
    });
  }

  private async loadMedia(
    userId: string,
    campaignId: string,
    mediaType: CampaignMediaType,
  ): Promise<OutgoingMedia[] | undefined> {
    if (mediaType === 'NENHUMA') return undefined;

    const items = await this.prisma.withTenantContext(userId, (tx) =>
      tx.campaignMedia.findMany({ where: { campaignId }, orderBy: { order: 'asc' } }),
    );
    if (items.length === 0) return undefined;

    return Promise.all(
      items.map(async (item): Promise<OutgoingMedia> => {
        const buffer = await this.storage.read(item.storageKey);
        return {
          buffer,
          mimeType: item.mimeType,
          type: item.type as OutgoingMedia['type'],
          filename: item.type === 'DOCUMENTO' ? `documento.${guessExtension(item.mimeType)}` : undefined,
        };
      }),
    );
  }
}
