import { AppError, InvalidNumberError, RateLimitError } from '../common/errors/app-error';
import { ErrorCategory } from '../common/errors/error-category.enum';
import { SendMessageProcessorService } from './send-message-processor.service';
import { SendMessageJobData } from './send-message.queue';

/**
 * Testes unitários de `SendMessageProcessorService` — toda dependência de
 * I/O (Prisma, provider WhatsApp, storage de mídia, filas) é mockada, no
 * mesmo padrão de `ContactsService.spec.ts` (Prisma mockado por
 * `withTenantContext` chamando `fn(tx)` diretamente, sem transação real).
 * Cobre as 5 etapas do `process()` documentadas no arquivo fonte:
 * idempotência, janela de horário (reagenda), delay anti-ban, personalização
 * + mídia só em `order === 0`, e os dois desfechos (sucesso/falha) — mais
 * `finalizeFailure` (idempotente, dead-letter) e a regra "FALHOU nunca
 * reverte" de `applyRecipientOutcome`.
 */
describe('SendMessageProcessorService', () => {
  const userId = 'user-1';
  const sessionId = 'session-1';
  const jobData: SendMessageJobData = { envioId: 'envio-1', userId, sessionId };

  function baseEnvio(overrides: Record<string, unknown> = {}) {
    return {
      id: 'envio-1',
      status: 'PENDENTE',
      recipientId: 'recipient-1',
      campaignId: 'campaign-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      campaign: { id: 'campaign-1', mediaType: 'NENHUMA' },
      message: { order: 0, text: 'Olá {ID1}' },
      recipient: { contact: { id: 'contact-1', normalizedPhone: '5511999998888', customFields: { ID1: 'João' } } },
      ...overrides,
    };
  }

  function buildService() {
    const txEnvio = {
      findUnique: jest.fn(async () => baseEnvio()),
      update: jest.fn(async () => undefined),
      findMany: jest.fn(async () => [{ status: 'ENVIADO' }]),
    };
    const txCampaignRecipient = {
      findUnique: jest.fn(async () => ({ id: 'recipient-1', status: 'PENDENTE' })),
      update: jest.fn(async () => undefined),
    };
    const txCampaign = {
      update: jest.fn(async () => ({ id: 'campaign-1', status: 'PENDENTE', pendingCount: 1, sentCount: 1, failedCount: 0 })),
    };
    const txSession = {
      update: jest.fn(async () => ({ contactsImported: 0, messagesSent: 1, messagesPending: 0, failures: 0 })),
    };
    const txCampaignMedia = { findMany: jest.fn(async () => []) };

    const tx = { envio: txEnvio, campaignRecipient: txCampaignRecipient, campaign: txCampaign, session: txSession, campaignMedia: txCampaignMedia };
    const prisma = { withTenantContext: jest.fn((_userId: string, fn: (tx: unknown) => unknown) => fn(tx)) };

    const provider = { sendMessage: jest.fn(async () => undefined) };
    const sessionService = {
      getOrCreateSession: jest.fn(async () => ({ id: sessionId, createdAt: new Date('2026-01-01T00:00:00Z') })),
      publishStats: jest.fn(),
    };
    const personalization = { render: jest.fn((text: string, fields: Record<string, string>) => text.replace(/\{ID1\}/, fields.ID1 ?? '{ID1}')) };
    const storage = { read: jest.fn(async () => Buffer.from('conteudo')) };
    const antiBan = { computeDelayMs: jest.fn(() => 0) };
    const timezone = { isWithinSendingWindow: jest.fn(() => true), msUntilNextWindow: jest.fn(() => 0) };
    const sendQueue = { reschedule: jest.fn(async () => undefined) };
    const deadLetter = { push: jest.fn(async () => undefined) };
    const logger = { error: jest.fn() };
    const metrics = { recordMessageSent: jest.fn(), recordMessageFailed: jest.fn() };
    const sessionGateway = { emitCampaignProgress: jest.fn() };

    const service = new SendMessageProcessorService(
      prisma as never,
      provider as never,
      sessionService as never,
      personalization as never,
      storage as never,
      antiBan as never,
      timezone as never,
      sendQueue as never,
      deadLetter as never,
      logger as never,
      metrics as never,
      sessionGateway as never,
    );

    return {
      service,
      txEnvio,
      txCampaignRecipient,
      txCampaign,
      txSession,
      txCampaignMedia,
      provider,
      sessionService,
      personalization,
      storage,
      antiBan,
      timezone,
      sendQueue,
      deadLetter,
      logger,
      metrics,
      sessionGateway,
    };
  }

  describe('process — idempotência', () => {
    it('não faz nada quando o Envio não existe mais', async () => {
      const { service, txEnvio, provider, sessionService } = buildService();
      txEnvio.findUnique.mockResolvedValueOnce(null);

      await service.process(jobData);

      expect(provider.sendMessage).not.toHaveBeenCalled();
      expect(sessionService.getOrCreateSession).not.toHaveBeenCalled();
    });

    it('não faz nada quando o Envio já saiu de PENDENTE (job duplicado)', async () => {
      const { service, txEnvio, provider } = buildService();
      txEnvio.findUnique.mockResolvedValueOnce(baseEnvio({ status: 'ENVIADO' }));

      await service.process(jobData);

      expect(provider.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('process — janela de horário', () => {
    it('reagenda e retorna sem enviar quando fora da janela do contato', async () => {
      const { service, timezone, sendQueue, provider, sessionService } = buildService();
      timezone.isWithinSendingWindow.mockReturnValueOnce(false);
      timezone.msUntilNextWindow.mockReturnValueOnce(12_345);

      await service.process(jobData);

      expect(sendQueue.reschedule).toHaveBeenCalledWith(sessionId, jobData, 12_345);
      expect(provider.sendMessage).not.toHaveBeenCalled();
      expect(sessionService.getOrCreateSession).not.toHaveBeenCalled(); // delay anti-ban nunca chega a ser calculado
    });
  });

  describe('process — sucesso', () => {
    it('personaliza o texto, envia via provider e marca ENVIADO (sem mídia fora de order 0)', async () => {
      const { service, provider, txEnvio, txSession, sessionService, metrics } = buildService();

      await service.process(jobData);

      expect(provider.sendMessage).toHaveBeenCalledWith(sessionId, { to: '5511999998888', text: 'Olá João', media: undefined });
      expect(txEnvio.update).toHaveBeenCalledWith({
        where: { id: 'envio-1' },
        data: { status: 'ENVIADO', sentAt: expect.any(Date), attempts: { increment: 1 }, failureReason: null },
      });
      expect(txSession.update).toHaveBeenCalledWith({
        where: { userId },
        data: { messagesSent: { increment: 1 }, messagesPending: { decrement: 1 } },
      });
      expect(sessionService.publishStats).toHaveBeenCalled();
      expect(metrics.recordMessageSent).toHaveBeenCalledWith(expect.any(Number));
      expect(metrics.recordMessageFailed).not.toHaveBeenCalled();
    });

    it('carrega mídia só quando a mensagem é a de order === 0 da campanha', async () => {
      const { service, txEnvio, txCampaignMedia, storage, provider } = buildService();
      txEnvio.findUnique.mockResolvedValueOnce(baseEnvio({ campaign: { id: 'campaign-1', mediaType: 'IMAGENS' } }));
      txCampaignMedia.findMany.mockResolvedValueOnce([
        { storageKey: 'k1', mimeType: 'image/png', type: 'IMAGENS', order: 0 },
      ]);

      await service.process(jobData);

      expect(storage.read).toHaveBeenCalledWith('k1');
      expect(provider.sendMessage).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({ media: [{ buffer: Buffer.from('conteudo'), mimeType: 'image/png', type: 'IMAGENS', filename: undefined }] }),
      );
    });

    it('não carrega mídia quando a mensagem NÃO é a de order 0, mesmo com campanha tendo mídia', async () => {
      const { service, txEnvio, storage, provider } = buildService();
      txEnvio.findUnique.mockResolvedValueOnce(
        baseEnvio({ campaign: { id: 'campaign-1', mediaType: 'IMAGENS' }, message: { order: 1, text: 'Segunda mensagem' } }),
      );

      await service.process(jobData);

      expect(storage.read).not.toHaveBeenCalled();
      expect(provider.sendMessage).toHaveBeenCalledWith(sessionId, expect.objectContaining({ media: undefined }));
    });
  });

  describe('process — falha de tentativa (ainda não definitiva)', () => {
    it('persiste attempts+failureReason categorizado e relança quando o provider lança AppError', async () => {
      const { service, provider, txEnvio, logger } = buildService();
      provider.sendMessage.mockRejectedValueOnce(new InvalidNumberError('não existe no whatsapp'));

      await expect(service.process(jobData)).rejects.toBeInstanceOf(InvalidNumberError);

      expect(txEnvio.update).toHaveBeenCalledWith({
        where: { id: 'envio-1' },
        data: { attempts: { increment: 1 }, failureReason: ErrorCategory.NUMERO_INVALIDO },
      });
      expect(logger.error).toHaveBeenCalled();
    });

    it('usa DESCONHECIDO quando o erro não é um AppError categorizado', async () => {
      const { service, provider, txEnvio } = buildService();
      provider.sendMessage.mockRejectedValueOnce(new Error('falha genérica de rede'));

      await expect(service.process(jobData)).rejects.toThrow('falha genérica de rede');

      expect(txEnvio.update).toHaveBeenCalledWith({
        where: { id: 'envio-1' },
        data: { attempts: { increment: 1 }, failureReason: ErrorCategory.DESCONHECIDO },
      });
    });

    it('rejeita antes de chamar o provider quando o contato não tem normalizedPhone', async () => {
      const { service, provider, txEnvio } = buildService();
      txEnvio.findUnique.mockResolvedValueOnce(
        baseEnvio({ recipient: { contact: { id: 'contact-1', normalizedPhone: null, customFields: {} } } }),
      );

      await expect(service.process(jobData)).rejects.toBeInstanceOf(AppError);

      expect(provider.sendMessage).not.toHaveBeenCalled();
      expect(txEnvio.update).toHaveBeenCalledWith({
        where: { id: 'envio-1' },
        data: { attempts: { increment: 1 }, failureReason: ErrorCategory.VALIDACAO },
      });
    });
  });

  describe('applyRecipientOutcome — regras de agregação (README §7)', () => {
    it('não marca CampaignRecipient/Campaign quando ainda há Envio irmão pendente', async () => {
      const { service, txEnvio, txCampaignRecipient, txCampaign, sessionGateway } = buildService();
      txEnvio.findMany.mockResolvedValueOnce([{ status: 'ENVIADO' }, { status: 'PENDENTE' }]);

      await service.process(jobData);

      expect(txCampaignRecipient.update).not.toHaveBeenCalled();
      expect(txCampaign.update).not.toHaveBeenCalled();
      expect(sessionGateway.emitCampaignProgress).not.toHaveBeenCalled();
    });

    it('FALHOU é terminal: um envio bem-sucedido posterior não reverte o destinatário já FALHOU', async () => {
      const { service, txCampaignRecipient, txCampaign, txEnvio, sessionGateway } = buildService();
      txCampaignRecipient.findUnique.mockResolvedValueOnce({ id: 'recipient-1', status: 'FALHOU' });

      await service.process(jobData);

      // O Envio individual ainda é marcado ENVIADO (a tentativa em si deu certo)...
      expect(txEnvio.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ENVIADO' }) }),
      );
      // ...mas o agregado do destinatário/campanha não muda, porque já é terminal.
      expect(txCampaignRecipient.update).not.toHaveBeenCalled();
      expect(txCampaign.update).not.toHaveBeenCalled();
      expect(sessionGateway.emitCampaignProgress).not.toHaveBeenCalled();
    });

    it('publica campaign_progress via SessionGateway após o commit, com o delta atualizado', async () => {
      const { service, txCampaign, sessionGateway } = buildService();
      txCampaign.update.mockResolvedValueOnce({ id: 'campaign-1', status: 'PENDENTE', pendingCount: 2, sentCount: 3, failedCount: 0 });

      await service.process(jobData);

      expect(sessionGateway.emitCampaignProgress).toHaveBeenCalledWith(userId, {
        id: 'campaign-1',
        status: 'PENDENTE',
        pendingCount: 2,
        sentCount: 3,
        failedCount: 0,
      });
    });

    it('promove Campaign.status para ENVIADA quando pendingCount chega a 0 (correção da etapa 18)', async () => {
      const { service, txCampaign, sessionGateway } = buildService();
      txCampaign.update.mockResolvedValueOnce({ id: 'campaign-1', status: 'PENDENTE', pendingCount: 0, sentCount: 10, failedCount: 0 });

      await service.process(jobData);

      expect(txCampaign.update).toHaveBeenCalledWith({ where: { id: 'campaign-1' }, data: { status: 'ENVIADA' } });
      expect(sessionGateway.emitCampaignProgress).toHaveBeenCalledWith(userId, {
        id: 'campaign-1',
        status: 'ENVIADA',
        pendingCount: 0,
        sentCount: 10,
        failedCount: 0,
      });
    });

    it('não repete a transição para ENVIADA quando a campanha já estava ENVIADA', async () => {
      const { service, txCampaign } = buildService();
      txCampaign.update.mockResolvedValueOnce({ id: 'campaign-1', status: 'ENVIADA', pendingCount: 0, sentCount: 10, failedCount: 0 });

      await service.process(jobData);

      // Só a 1ª chamada (o update de pendingCount/sentCount) — nenhuma 2ª chamada setando status.
      expect(txCampaign.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('finalizeFailure', () => {
    it('não faz nada quando o Envio não existe mais', async () => {
      const { service, txEnvio, deadLetter } = buildService();
      txEnvio.findUnique.mockResolvedValueOnce(null);

      await service.finalizeFailure(jobData, 5, new Error('x'));

      expect(txEnvio.update).not.toHaveBeenCalled();
      expect(deadLetter.push).not.toHaveBeenCalled();
    });

    it('é idempotente: não repete o rollup nem o push quando o Envio já está FALHOU', async () => {
      const { service, txEnvio, txCampaignRecipient, deadLetter, metrics } = buildService();
      txEnvio.findUnique.mockResolvedValueOnce({ id: 'envio-1', status: 'FALHOU', failureReason: 'x', recipientId: 'recipient-1', campaignId: 'campaign-1' });

      await service.finalizeFailure(jobData, 5, new Error('x'));

      expect(txEnvio.update).not.toHaveBeenCalled();
      expect(txCampaignRecipient.update).not.toHaveBeenCalled();
      expect(deadLetter.push).not.toHaveBeenCalled();
      expect(metrics.recordMessageFailed).not.toHaveBeenCalled();
    });

    it('transição terminal completa: marca FALHOU, rebaixa o destinatário, incrementa failures e envia para dead-letter', async () => {
      const { service, txEnvio, txCampaignRecipient, txCampaign, txSession, deadLetter, metrics } = buildService();
      txEnvio.findUnique.mockResolvedValueOnce({
        id: 'envio-1',
        status: 'PENDENTE',
        failureReason: ErrorCategory.RATE_LIMIT,
        recipientId: 'recipient-1',
        campaignId: 'campaign-1',
      });

      await service.finalizeFailure(jobData, 5, new RateLimitError('limite atingido'));

      expect(txEnvio.update).toHaveBeenCalledWith({
        where: { id: 'envio-1' },
        data: { status: 'FALHOU', failureReason: ErrorCategory.RATE_LIMIT },
      });
      expect(txCampaignRecipient.update).toHaveBeenCalledWith({ where: { id: 'recipient-1' }, data: { status: 'FALHOU' } });
      expect(txCampaign.update).toHaveBeenCalledWith({
        where: { id: 'campaign-1' },
        data: { pendingCount: { decrement: 1 }, failedCount: { increment: 1 } },
      });
      expect(txSession.update).toHaveBeenCalledWith({
        where: { userId },
        data: { failures: { increment: 1 }, messagesPending: { decrement: 1 } },
      });
      expect(deadLetter.push).toHaveBeenCalledWith({
        envioId: 'envio-1',
        campaignId: 'campaign-1',
        userId,
        sessionId,
        reason: ErrorCategory.RATE_LIMIT,
        attemptsMade: 5,
      });
      expect(metrics.recordMessageFailed).toHaveBeenCalledTimes(1);
    });

    it('usa a categoria do lastError quando o Envio ainda não tinha failureReason gravado', async () => {
      const { service, txEnvio, deadLetter } = buildService();
      txEnvio.findUnique.mockResolvedValueOnce({
        id: 'envio-1',
        status: 'PENDENTE',
        failureReason: null,
        recipientId: 'recipient-1',
        campaignId: 'campaign-1',
      });

      await service.finalizeFailure(jobData, 5, new InvalidNumberError('não existe'));

      expect(txEnvio.update).toHaveBeenCalledWith({
        where: { id: 'envio-1' },
        data: { status: 'FALHOU', failureReason: ErrorCategory.NUMERO_INVALIDO },
      });
      expect(deadLetter.push).toHaveBeenCalledWith(expect.objectContaining({ reason: ErrorCategory.NUMERO_INVALIDO }));
    });
  });
});
