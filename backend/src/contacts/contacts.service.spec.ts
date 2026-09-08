import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ContactsService } from './contacts.service';

/**
 * Testes unitários com Prisma/fila/SessionService mockados — cobrem o
 * contrato espelhado 1:1 do `ContactRepository` do front (README raiz §13):
 * parsing de `importContacts` idêntico ao mock, orquestração da fila
 * `queue:validate-numbers` (enfileira só quando de fato cria/reabre
 * verificação) e o incremento de `Session.contactsImported` na entrada
 * (nunca no worker de verificação — ver comentário em contacts.service.ts).
 */
describe('ContactsService', () => {
  function buildService() {
    let nextId = 1;
    const txContact = {
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: `contact-${nextId++}`,
        status: 'PENDENTE',
        normalizedPhone: null,
        failureReason: null,
        ...data,
      })),
      findUnique: jest.fn(),
      update: jest.fn(async () => undefined),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    };
    const txSession = {
      update: jest.fn(async () => ({
        contactsImported: 0,
        messagesSent: 0,
        messagesPending: 0,
        failures: 0,
      })),
    };
    const prisma = {
      withTenantContext: jest.fn((_userId: string, fn: (tx: { contact: typeof txContact; session: typeof txSession }) => unknown) =>
        fn({ contact: txContact, session: txSession }),
      ),
    };
    const queue = { enqueue: jest.fn(async () => undefined) };
    const sessionService = {
      getOrCreateSession: jest.fn(async () => ({ id: 'session-1' })),
      publishStats: jest.fn(),
    };

    const service = new ContactsService(prisma as never, queue as never, sessionService as never);
    return { service, prisma, txContact, txSession, queue, sessionService };
  }

  describe('getContacts', () => {
    it('usa o normalizedPhone (com "+") quando já validado, senão o rawPhone como digitado', async () => {
      const { service, txContact } = buildService();
      txContact.findMany.mockResolvedValue([
        { id: 'c1', rawPhone: '5511999998888', normalizedPhone: '5511999998888', customFields: {}, status: 'VALIDO', failureReason: null },
        { id: 'c2', rawPhone: '+55 11 98888-7777', normalizedPhone: null, customFields: {}, status: 'PENDENTE', failureReason: null },
      ] as never);

      const contacts = await service.getContacts('user-1');

      expect(contacts).toEqual([
        { id: 'c1', phone: '+5511999998888', customFields: {}, status: 'VALIDO', failureReason: null },
        { id: 'c2', phone: '+55 11 98888-7777', customFields: {}, status: 'PENDENTE', failureReason: null },
      ]);
    });
  });

  describe('importContacts', () => {
    it('espelha o parsing do mock: telefone primeiro, resto vira ID1/ID2/…, linhas vazias ignoradas', async () => {
      const { service, txContact, queue, sessionService, txSession } = buildService();
      const rawText = [
        '+5511999998888, João, Cliente VIP',
        '',
        '   ',
        '5511888887777,Maria',
        'numero-invalido,Pedro',
      ].join('\n');

      const result = await service.importContacts('user-1', rawText);

      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(1);
      expect(txContact.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', rawPhone: '+5511999998888', customFields: { ID1: 'João', ID2: 'Cliente VIP' } },
      });
      expect(txContact.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', rawPhone: '5511888887777', customFields: { ID1: 'Maria' } },
      });
      expect(queue.enqueue).toHaveBeenCalledTimes(2);
      expect(sessionService.getOrCreateSession).toHaveBeenCalledWith('user-1');
      expect(txSession.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: { contactsImported: { increment: 2 } },
      });
    });

    it('não toca na fila nem nas estatísticas quando tudo é inválido', async () => {
      const { service, txContact, queue, sessionService } = buildService();

      const result = await service.importContacts('user-1', 'lixo,teste\noutro-lixo');

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(2);
      expect(txContact.create).not.toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
      expect(sessionService.getOrCreateSession).not.toHaveBeenCalled();
    });

    it('aceita telefone sem "+" (mesma tolerância do mock, só que também sem exigir DDI)', async () => {
      const { service } = buildService();
      const result = await service.importContacts('user-1', '5511999998888');
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);
    });
  });

  describe('addContact', () => {
    it('rejeita telefone implausível sem tocar no banco ou na fila', async () => {
      const { service, txContact, queue } = buildService();

      await expect(service.addContact('user-1', 'abc')).rejects.toBeInstanceOf(BadRequestException);
      expect(txContact.create).not.toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('cria o contato PENDENTE, incrementa contactsImported e enfileira a verificação', async () => {
      const { service, txContact, queue, txSession } = buildService();

      await service.addContact('user-1', '+5511999998888', { ID1: 'João' });

      expect(txContact.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', rawPhone: '+5511999998888', customFields: { ID1: 'João' } },
      });
      expect(txSession.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: { contactsImported: { increment: 1 } },
      });
      expect(queue.enqueue).toHaveBeenCalledWith({ contactId: 'contact-1', userId: 'user-1' });
    });
  });

  describe('updateContact', () => {
    it('lança NotFoundException quando o contato não existe', async () => {
      const { service, txContact } = buildService();
      txContact.findUnique.mockResolvedValue(null);

      await expect(service.updateContact('user-1', 'id-inexistente', '+5511999998888')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(txContact.update).not.toHaveBeenCalled();
    });

    it('rejeita telefone implausível sem atualizar nada', async () => {
      const { service, txContact } = buildService();
      txContact.findUnique.mockResolvedValue({ id: 'c1', rawPhone: '+5511999998888' });

      await expect(service.updateContact('user-1', 'c1', 'abc')).rejects.toBeInstanceOf(BadRequestException);
      expect(txContact.update).not.toHaveBeenCalled();
    });

    it('quando o telefone NÃO muda, não reabre verificação nem reenfileira', async () => {
      const { service, txContact, queue } = buildService();
      txContact.findUnique.mockResolvedValue({ id: 'c1', rawPhone: '+5511999998888' });

      await service.updateContact('user-1', 'c1', '+5511999998888', { ID1: 'Novo' });

      expect(txContact.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { rawPhone: '+5511999998888', customFields: { ID1: 'Novo' } },
      });
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('quando o telefone muda, reseta o estado de verificação e reenfileira', async () => {
      const { service, txContact, queue } = buildService();
      txContact.findUnique.mockResolvedValue({ id: 'c1', rawPhone: '+5511999998888' });

      await service.updateContact('user-1', 'c1', '+5511988887777');

      expect(txContact.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: {
          rawPhone: '+5511988887777',
          customFields: {},
          status: 'PENDENTE',
          normalizedPhone: null,
          attempts: 0,
          failureReason: null,
          verificationLog: [],
        },
      });
      expect(queue.enqueue).toHaveBeenCalledWith({ contactId: 'c1', userId: 'user-1' });
    });
  });

  describe('removeContact', () => {
    it('remove por id e não erra quando o id não existe (mesmo comportamento do mock)', async () => {
      const { service, txContact } = buildService();
      txContact.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.removeContact('user-1', 'id-que-nao-existe')).resolves.toEqual([]);
      expect(txContact.deleteMany).toHaveBeenCalledWith({ where: { id: 'id-que-nao-existe' } });
    });
  });
});
