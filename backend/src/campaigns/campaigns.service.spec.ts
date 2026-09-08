import { BadRequestException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';

/**
 * Testes unitários com Prisma mockado — cobrem a separação de escopo com a
 * etapa 15 (aqui só persiste estrutura em PENDENTE, nunca envia nada), a
 * resolução de destinatários sempre restrita a `Contact.status = VALIDO`
 * (README raiz §13), a adoção de mídia (rejeita id inexistente/já usado e
 * tipos mistos), o caso-limite `recipientCount === 0` → campanha já nasce
 * ENVIADA (mesma lógica do mock, que não tem estado "pendente sem ninguém
 * para enviar"), e a etapa 16 (enforcement de limite de uso via
 * `PlansService.assertWithinUsageLimit`, chamado DENTRO da mesma transação,
 * antes de `Envio.createMany` — ver comentário em `campaigns.service.ts`).
 */
describe('CampaignsService', () => {
  function buildService() {
    let nextCampaignId = 1;

    const txContact = { findMany: jest.fn(async () => [] as { id: string }[]) };
    const txCampaign = {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: `campaign-${nextCampaignId++}`,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        sentCount: 0,
        failedCount: 0,
        ...data,
      })),
      findMany: jest.fn(async () => [] as unknown[]),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    };
    const txCampaignMessage = {
      createMany: jest.fn(async () => ({ count: 0 })),
      findMany: jest.fn(async () => [] as { id: string }[]),
    };
    const txCampaignMedia = {
      findMany: jest.fn(async () => [] as { id: string; type: string }[]),
      updateMany: jest.fn(async () => ({ count: 0 })),
    };
    const txCampaignRecipient = {
      createMany: jest.fn(async () => ({ count: 0 })),
      findMany: jest.fn(async () => [] as { id: string }[]),
    };
    const txEnvio = { createMany: jest.fn(async () => ({ count: 0 })) };

    const tx = {
      contact: txContact,
      campaign: txCampaign,
      campaignMessage: txCampaignMessage,
      campaignMedia: txCampaignMedia,
      campaignRecipient: txCampaignRecipient,
      envio: txEnvio,
    };

    const prisma = { withTenantContext: jest.fn((_userId: string, fn: (tx: unknown) => unknown) => fn(tx)) };
    const sendQueue = { enqueueCampaign: jest.fn(async () => 'session-1') };
    const sendWorker = { ensureWorker: jest.fn() };
    const plansService = { assertWithinUsageLimit: jest.fn(async () => undefined) };

    const service = new CampaignsService(prisma as never, sendQueue as never, sendWorker as never, plansService as never);
    return {
      service,
      prisma,
      tx,
      txContact,
      txCampaign,
      txCampaignMessage,
      txCampaignMedia,
      txCampaignRecipient,
      txEnvio,
      sendQueue,
      sendWorker,
      plansService,
    };
  }

  describe('createCampaign — validação de mensagens', () => {
    it('rejeita quando alguma mensagem fica vazia após trim, sem abrir transação', async () => {
      const { service, prisma } = buildService();

      await expect(service.createCampaign('user-1', { messages: ['Olá', '   '] })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.withTenantContext).not.toHaveBeenCalled();
    });
  });

  describe('createCampaign — resolução de destinatários', () => {
    it('sem recipientIds, resolve para todos os contatos VALIDO do usuário', async () => {
      const { service, txContact, txCampaign } = buildService();
      txContact.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);

      await service.createCampaign('user-1', { messages: ['Oi'] });

      expect(txContact.findMany).toHaveBeenCalledWith({ where: { status: 'VALIDO' }, select: { id: true } });
      expect(txCampaign.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PENDENTE', recipientCount: 2, pendingCount: 2 }) }),
      );
    });

    it('com recipientIds, filtra por VALIDO E pelos ids informados', async () => {
      const { service, txContact } = buildService();
      txContact.findMany.mockResolvedValue([{ id: 'c1' }]);

      await service.createCampaign('user-1', { messages: ['Oi'], recipientIds: ['c1', 'c2'] });

      expect(txContact.findMany).toHaveBeenCalledWith({
        where: { status: 'VALIDO', id: { in: ['c1', 'c2'] } },
        select: { id: true },
      });
    });

    it('recipientCount === 0 já nasce ENVIADA e não cria recipients nem envios', async () => {
      const { service, txContact, txCampaign, txCampaignRecipient, txEnvio } = buildService();
      txContact.findMany.mockResolvedValue([]);

      await service.createCampaign('user-1', { messages: ['Oi'] });

      expect(txCampaign.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ENVIADA', recipientCount: 0, pendingCount: 0 }) }),
      );
      expect(txCampaignRecipient.createMany).not.toHaveBeenCalled();
      expect(txEnvio.createMany).not.toHaveBeenCalled();
    });
  });

  describe('createCampaign — persistência de mensagens, recipients e envios (produto cartesiano)', () => {
    it('cria 1 Envio por par (destinatário × mensagem) e nunca toca sentCount/failedCount', async () => {
      const { service, txContact, txCampaignMessage, txCampaignRecipient, txEnvio, txCampaign } = buildService();
      txContact.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
      txCampaignMessage.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
      txCampaignRecipient.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);

      await service.createCampaign('user-1', { messages: ['Oi', 'Tudo bem?'] });

      expect(txCampaignMessage.createMany).toHaveBeenCalledWith({
        data: [
          { campaignId: 'campaign-1', userId: 'user-1', order: 0, text: 'Oi' },
          { campaignId: 'campaign-1', userId: 'user-1', order: 1, text: 'Tudo bem?' },
        ],
      });
      expect(txCampaignRecipient.createMany).toHaveBeenCalledWith({
        data: [
          { campaignId: 'campaign-1', contactId: 'c1', userId: 'user-1' },
          { campaignId: 'campaign-1', contactId: 'c2', userId: 'user-1' },
        ],
      });
      expect(txEnvio.createMany).toHaveBeenCalledWith({
        data: [
          { campaignId: 'campaign-1', recipientId: 'r1', messageId: 'm1', userId: 'user-1' },
          { campaignId: 'campaign-1', recipientId: 'r1', messageId: 'm2', userId: 'user-1' },
          { campaignId: 'campaign-1', recipientId: 'r2', messageId: 'm1', userId: 'user-1' },
          { campaignId: 'campaign-1', recipientId: 'r2', messageId: 'm2', userId: 'user-1' },
        ],
      });
      expect(txCampaign.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.not.objectContaining({ sentCount: expect.anything(), failedCount: expect.anything() }) }),
      );
    });
  });

  describe('createCampaign — adoção de mídia', () => {
    it('rejeita quando algum mediaId não existe/não pertence ao usuário/já foi usado', async () => {
      const { service, txCampaignMedia } = buildService();
      txCampaignMedia.findMany.mockResolvedValue([{ id: 'media-1', type: 'IMAGENS' }]);

      await expect(service.createCampaign('user-1', { messages: ['Oi'], mediaIds: ['media-1', 'media-2'] })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejeita quando as mídias adotadas têm tipos diferentes', async () => {
      const { service, txCampaignMedia } = buildService();
      txCampaignMedia.findMany.mockResolvedValue([
        { id: 'media-1', type: 'IMAGENS' },
        { id: 'media-2', type: 'AUDIO' },
      ]);

      await expect(
        service.createCampaign('user-1', { messages: ['Oi'], mediaIds: ['media-1', 'media-2'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('adota mídias válidas do mesmo tipo e vincula via campaignId', async () => {
      const { service, txCampaignMedia, txCampaign } = buildService();
      txCampaignMedia.findMany.mockResolvedValue([
        { id: 'media-1', type: 'IMAGENS' },
        { id: 'media-2', type: 'IMAGENS' },
      ]);

      await service.createCampaign('user-1', { messages: ['Oi'], mediaIds: ['media-1', 'media-2'] });

      expect(txCampaignMedia.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['media-1', 'media-2'] }, userId: 'user-1', campaignId: null },
      });
      expect(txCampaign.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ mediaType: 'IMAGENS', mediaCount: 2 }) }),
      );
      expect(txCampaignMedia.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['media-1', 'media-2'] } },
        data: { campaignId: 'campaign-1' },
      });
    });

    it('sem mediaIds, cria campanha com mediaType NENHUMA e não toca em campaignMedia', async () => {
      const { service, txCampaignMedia, txCampaign } = buildService();

      await service.createCampaign('user-1', { messages: ['Oi'] });

      expect(txCampaignMedia.findMany).not.toHaveBeenCalled();
      expect(txCampaign.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ mediaType: 'NENHUMA', mediaCount: 0 }) }),
      );
      expect(txCampaignMedia.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('createCampaign — enforcement de limite de uso (etapa 16)', () => {
    it('chama assertWithinUsageLimit dentro da transação, com quantity = destinatários × mensagens, antes de Envio.createMany', async () => {
      const { service, txContact, txCampaignMessage, txCampaignRecipient, plansService, txEnvio } = buildService();
      txContact.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
      txCampaignMessage.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
      txCampaignRecipient.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);

      await service.createCampaign('user-1', { messages: ['Oi', 'Tudo bem?'] });

      expect(plansService.assertWithinUsageLimit).toHaveBeenCalledWith(expect.anything(), 'user-1', 4);
      const assertOrder = plansService.assertWithinUsageLimit.mock.invocationCallOrder[0];
      const createManyOrder = txEnvio.createMany.mock.invocationCallOrder[0];
      expect(assertOrder).toBeLessThan(createManyOrder);
    });

    it('quando assertWithinUsageLimit rejeita, a criação inteira falha e nenhum Envio é persistido', async () => {
      const { service, txContact, txCampaignMessage, txCampaignRecipient, plansService, txEnvio, sendQueue } = buildService();
      txContact.findMany.mockResolvedValue([{ id: 'c1' }]);
      txCampaignMessage.findMany.mockResolvedValue([{ id: 'm1' }]);
      txCampaignRecipient.findMany.mockResolvedValue([{ id: 'r1' }]);
      plansService.assertWithinUsageLimit.mockRejectedValue(new Error('limite atingido'));

      await expect(service.createCampaign('user-1', { messages: ['Oi'] })).rejects.toThrow('limite atingido');

      expect(txEnvio.createMany).not.toHaveBeenCalled();
      expect(sendQueue.enqueueCampaign).not.toHaveBeenCalled();
    });

    it('recipientCount === 0 não chama assertWithinUsageLimit (nada a enfileirar)', async () => {
      const { service, txContact, plansService } = buildService();
      txContact.findMany.mockResolvedValue([]);

      await service.createCampaign('user-1', { messages: ['Oi'] });

      expect(plansService.assertWithinUsageLimit).not.toHaveBeenCalled();
    });
  });

  describe('createCampaign — enfileiramento pós-commit (etapa 15)', () => {
    it('com recipientCount > 0, chama enqueueCampaign e ensureWorker(sessionId) só depois da transação commitar', async () => {
      const { service, txContact, txCampaignMessage, txCampaignRecipient, sendQueue, sendWorker } = buildService();
      txContact.findMany.mockResolvedValue([{ id: 'c1' }]);
      txCampaignMessage.findMany.mockResolvedValue([{ id: 'm1' }]);
      txCampaignRecipient.findMany.mockResolvedValue([{ id: 'r1' }]);
      sendQueue.enqueueCampaign.mockResolvedValue('session-42');

      await service.createCampaign('user-1', { messages: ['Oi'] });

      expect(sendQueue.enqueueCampaign).toHaveBeenCalledWith('user-1', 'campaign-1');
      expect(sendWorker.ensureWorker).toHaveBeenCalledWith('session-42');
    });

    it('recipientCount === 0 não chama enqueueCampaign nem ensureWorker', async () => {
      const { service, txContact, sendQueue, sendWorker } = buildService();
      txContact.findMany.mockResolvedValue([]);

      await service.createCampaign('user-1', { messages: ['Oi'] });

      expect(sendQueue.enqueueCampaign).not.toHaveBeenCalled();
      expect(sendWorker.ensureWorker).not.toHaveBeenCalled();
    });

    it('quando enqueueCampaign resolve undefined (sessão indisponível), não chama ensureWorker', async () => {
      const { service, txContact, txCampaignMessage, txCampaignRecipient, sendQueue, sendWorker } = buildService();
      txContact.findMany.mockResolvedValue([{ id: 'c1' }]);
      txCampaignMessage.findMany.mockResolvedValue([{ id: 'm1' }]);
      txCampaignRecipient.findMany.mockResolvedValue([{ id: 'r1' }]);
      sendQueue.enqueueCampaign.mockResolvedValue(undefined);

      await service.createCampaign('user-1', { messages: ['Oi'] });

      expect(sendWorker.ensureWorker).not.toHaveBeenCalled();
    });
  });

  describe('clearHistory', () => {
    it('apaga todas as campanhas do usuário e retorna lista vazia', async () => {
      const { service, txCampaign } = buildService();

      await expect(service.clearHistory('user-1')).resolves.toEqual([]);
      expect(txCampaign.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    });
  });
});
