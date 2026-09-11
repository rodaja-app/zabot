import { BadRequestException, Injectable } from '@nestjs/common';
import { CampaignMediaType, CampaignStatus, Prisma, SessionStatus, WalletTransactionType } from '@prisma/client';
import { InsufficientBalanceError, SessionNotConnectedError } from '../common/errors/app-error';
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
      // Uma campanha só existe quando pode de fato ser enviada. Assim não
      // poluímos o histórico com tentativas feitas sem um WhatsApp conectado.
      const session = await tx.session.findUnique({
        where: { userId },
        select: { status: true },
      });
      if (session?.status !== SessionStatus.CONECTADA) {
        throw new SessionNotConnectedError(
          'Conecte seu WhatsApp na tela Início antes de iniciar uma campanha.',
        );
      }

      const recipientContactIds = await this.resolveRecipientContactIds(tx, dto.recipientIds);
      const recipientCount = recipientContactIds.length;
      if (recipientCount === 0) {
        throw new BadRequestException(
          'Não há contatos válidos para esta campanha. Aguarde a validação dos números e tente novamente.',
        );
      }

      const media = await this.adoptMedia(tx, userId, dto.mediaIds ?? []);

      const campaign = await tx.campaign.create({
        data: {
          userId,
          status: CampaignStatus.PENDENTE,
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

      // Carteira de créditos ("tudo ou nada", decisão do usuário) — check +
      // débito de `Wallet.balance` DENTRO desta mesma transação, antes de
      // `Envio.createMany`: se o saldo não cobrir a campanha inteira,
      // `debitWalletOrThrow` lança e a transação inteira (campanha,
      // mensagens, mídia, destinatários já persistidos acima) faz rollback —
      // nenhuma campanha "parcial" fica salva, e nenhum crédito é debitado
      // sem a campanha ser criada de verdade. `envios.length` = destinatários
      // × mensagens, igual à contagem feita para `Campaign.recipientCount`
      // (enfileirado, não entregue) — 1 crédito por `Envio`.
      await this.debitWalletOrThrow(tx, userId, envios.length, campaign.id);

      await tx.envio.createMany({ data: envios });

      createdCampaignId = campaign.id;
    });

    // Fora da transação de cima (só depois de commitada de verdade — os
    // `Envio` PENDENTE precisam estar visíveis para a query que `enqueueCampaign`
    // faz na sua própria transação). `createdCampaignId` só fica setado
    // quando há envios de verdade para enfileirar: tentativas sem sessão,
    // contatos válidos ou saldo são rejeitadas antes de a campanha existir.
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
   * Débito "tudo ou nada" da carteira de créditos, dentro da mesma transação
   * que cria a campanha (ver comentário em `createCampaign` acima). Usuário
   * sem `Wallet` (nunca recarregou) é tratado como saldo 0 — mesma filosofia
   * de "nunca inventar acesso sem dado que confirme" já usada em
   * `ContactStatus`/`EnvioStatus`. 1 crédito = 1 `Envio` (destinatário ×
   * mensagem), nunca uma fração — se o saldo não cobrir a campanha inteira,
   * nada é debitado e nenhum `Envio` é criado (rollback da transação inteira).
   *
   * O `updateMany` com `balance: wallet.balance` na cláusula `where` funciona
   * como compare-and-swap: se outra transação concorrente já tiver alterado o
   * saldo entre o `findUnique` acima e este `update` (mesmo sob READ
   * COMMITTED), `count` vem 0 e a chamada falha em vez de debitar duas vezes
   * ou deixar o saldo ir negativo silenciosamente.
   */
  private async debitWalletOrThrow(
    tx: Prisma.TransactionClient,
    userId: string,
    quantity: number,
    campaignId: string,
  ): Promise<void> {
    if (quantity <= 0) return;

    const wallet = await tx.wallet.findUnique({ where: { userId } });
    const balance = wallet?.balance ?? 0;

    if (!wallet || quantity > balance) {
      throw new InsufficientBalanceError(
        `Saldo insuficiente para esta campanha (necessário ${quantity} créditos, disponível ${balance}).`,
        { userId, balance, requested: quantity },
      );
    }

    const updated = await tx.wallet.updateMany({
      where: { userId, balance: wallet.balance },
      data: { balance: { decrement: quantity } },
    });
    if (updated.count === 0) {
      throw new InsufficientBalanceError('Conflito ao debitar créditos da carteira — tente novamente.', { userId });
    }

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        userId,
        type: WalletTransactionType.CONSUMO,
        credits: quantity,
        campaignId,
      },
    });
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
