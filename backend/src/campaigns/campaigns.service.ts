import { BadRequestException, Injectable } from '@nestjs/common';
import { CampaignMediaType, CampaignStatus, Prisma } from '@prisma/client';
import { PlansService } from '../plans/plans.service';
import { PrismaService } from '../prisma/prisma.service';
import { SendMessageQueueService } from '../sending/send-message.queue';
import { SendMessageWorker } from '../sending/send-message.worker';
import { CampaignDto, toCampaignDto } from './dto/campaign.dto';
import { CreateCampaignDto } from './dto/create-campaign.dto';

/**
 * Etapa 14 (Motor de mensagens e campanhas — README raiz §5/6/7/13).
 *
 * Escopo desta etapa, deliberadamente: PERSISTIR a campanha por completo
 * (mensagens, mídia adotada, destinatários resolvidos e 1 `Envio` PENDENTE
 * por destinatário×mensagem) — `Campaign.sentCount/failedCount` só é tocado
 * depois, pela transição real de cada `Envio` (README raiz §7, ver
 * `SendMessageProcessorService.applyRecipientOutcome`), nunca aqui na
 * criação. A partir da etapa 15, `createCampaign` chama
 * `SendMessageQueueService.enqueueCampaign` (que lê os `Envio`s PENDENTE já
 * persistidos abaixo e os transforma em jobs BullMQ) + `SendMessageWorker.ensureWorker`
 * (garante um consumidor rodando para a sessão) só DEPOIS que a transação
 * de persistência commitou — separa "o que enviar" (aqui) de "quando/como
 * enviar com segurança" (etapa 15), sem sobreposição de responsabilidade
 * entre os dois módulos.
 */
@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sendQueue: SendMessageQueueService,
    private readonly sendWorker: SendMessageWorker,
    private readonly plansService: PlansService,
  ) {}

  async getCampaigns(userId: string): Promise<CampaignDto[]> {
    const campaigns = await this.prisma.withTenantContext(userId, (tx) =>
      tx.campaign.findMany({
        orderBy: { createdAt: 'desc' },
        include: { messages: { orderBy: { order: 'asc' } } },
      }),
    );
    return campaigns.map(toCampaignDto);
  }

  async createCampaign(userId: string, dto: CreateCampaignDto): Promise<CampaignDto[]> {
    const messages = dto.messages.map((text) => text.trim());
    if (messages.some((text) => text.length === 0)) {
      throw new BadRequestException('Nenhuma mensagem da campanha pode ficar vazia após remover espaços.');
    }

    let createdCampaignId: string | undefined;

    await this.prisma.withTenantContext(userId, async (tx) => {
      const media = await this.adoptMedia(tx, userId, dto.mediaIds ?? []);
      const recipientContactIds = await this.resolveRecipientContactIds(tx, dto.recipientIds);
      const recipientCount = recipientContactIds.length;

      const campaign = await tx.campaign.create({
        data: {
          userId,
          status: recipientCount === 0 ? CampaignStatus.ENVIADA : CampaignStatus.PENDENTE,
          mediaType: media.type,
          mediaCount: media.ids.length,
          recipientCount,
          pendingCount: recipientCount,
        },
      });

      await tx.campaignMessage.createMany({
        data: messages.map((text, order) => ({ campaignId: campaign.id, userId, order, text })),
      });

      if (media.ids.length > 0) {
        await tx.campaignMedia.updateMany({
          where: { id: { in: media.ids } },
          data: { campaignId: campaign.id },
        });
      }

      if (recipientCount === 0) return;

      await tx.campaignRecipient.createMany({
        data: recipientContactIds.map((contactId) => ({ campaignId: campaign.id, contactId, userId })),
      });

      const [createdMessages, createdRecipients] = await Promise.all([
        tx.campaignMessage.findMany({ where: { campaignId: campaign.id } }),
        tx.campaignRecipient.findMany({ where: { campaignId: campaign.id } }),
      ]);

      const envios: Prisma.EnvioCreateManyInput[] = [];
      for (const recipient of createdRecipients) {
        for (const message of createdMessages) {
          envios.push({ campaignId: campaign.id, recipientId: recipient.id, messageId: message.id, userId });
        }
      }

      // Etapa 16 ("Bloquear novos envios") — check + incremento de
      // `Subscription.messagesUsed` DENTRO desta mesma transação, antes de
      // `Envio.createMany`: se estourar o limite, `assertWithinUsageLimit`
      // lança e a transação inteira (campanha, mensagens, mídia,
      // destinatários já persistidos acima) faz rollback — nenhuma campanha
      // "parcial" fica salva. `envios.length` = destinatários × mensagens,
      // igual à contagem feita para `Campaign.recipientCount` (enfileirado,
      // não entregue).
      await this.plansService.assertWithinUsageLimit(tx, userId, envios.length);

      await tx.envio.createMany({ data: envios });

      createdCampaignId = campaign.id;
    });

    // Fora da transação de cima (só depois de commitada de verdade — os
    // `Envio` PENDENTE precisam estar visíveis para a query que `enqueueCampaign`
    // faz na sua própria transação). `createdCampaignId` só fica setado
    // quando `recipientCount > 0` (campanha com `Envio`s de verdade para
    // enfileirar); campanha sem destinatário já nasce ENVIADA acima e não
    // tem nada para o worker consumir.
    if (createdCampaignId) {
      const sessionId = await this.sendQueue.enqueueCampaign(userId, createdCampaignId);
      if (sessionId) this.sendWorker.ensureWorker(sessionId);
    }

    return this.getCampaigns(userId);
  }

  /** Espelha `clearHistory()` do front — apaga tudo (cascade cuida de mensagens/mídia/destinatários/envios). */
  async clearHistory(userId: string): Promise<CampaignDto[]> {
    await this.prisma.withTenantContext(userId, (tx) => tx.campaign.deleteMany({ where: { userId } }));
    return [];
  }

  /**
   * "Todos" (`recipientIds` omitido/vazio) resolve para todo contato
   * VALIDO do usuário; "específicos" filtra pelos ids informados, mas
   * SEMPRE restrito a VALIDO — nunca envia para um número ainda não
   * confirmado no WhatsApp (PENDENTE) ou já confirmado como inexistente
   * (INVALIDO), mesmo que o front (que hoje deixa escolher entre todos os
   * contatos importados, sem filtrar por status — ver `nova_campanha_screen.dart`)
   * tenha permitido a seleção.
   */
  private async resolveRecipientContactIds(
    tx: Prisma.TransactionClient,
    recipientIds: string[] | undefined,
  ): Promise<string[]> {
    const where: Prisma.ContactWhereInput = { status: 'VALIDO' };
    if (recipientIds && recipientIds.length > 0) {
      where.id = { in: recipientIds };
    }
    const contacts = await tx.contact.findMany({ where, select: { id: true } });
    return contacts.map((c) => c.id);
  }

  /**
   * Adota mídias já enviadas via `POST /campaigns/media` (ainda sem
   * `campaignId`) — rejeita ids inexistentes/já usados e mídias de tipos
   * misturados (o front só suporta 1 `CampaignMediaType` por campanha).
   */
  private async adoptMedia(
    tx: Prisma.TransactionClient,
    userId: string,
    mediaIds: string[],
  ): Promise<{ ids: string[]; type: CampaignMediaType }> {
    if (mediaIds.length === 0) {
      return { ids: [], type: CampaignMediaType.NENHUMA };
    }

    const media = await tx.campaignMedia.findMany({ where: { id: { in: mediaIds }, userId, campaignId: null } });
    if (media.length !== mediaIds.length) {
      throw new BadRequestException(
        'Uma ou mais mídias informadas não existem, não pertencem a este usuário ou já foram usadas em outra campanha.',
      );
    }

    const distinctTypes = new Set(media.map((m) => m.type));
    if (distinctTypes.size > 1) {
      throw new BadRequestException('Uma campanha só pode ter mídias de um único tipo (imagens, áudio ou documento).');
    }

    return { ids: media.map((m) => m.id), type: media[0].type };
  }
}
