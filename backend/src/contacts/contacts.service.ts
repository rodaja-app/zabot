import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Contact } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../whatsapp/session.service';
import { ContactDto, ContactImportResultDto } from './dto/contact.dto';
import { PhoneNumberService } from './phone-number.service';
import { ValidateNumbersQueueService } from './validate-numbers.queue';

/** Mesma tolerância do front (`_phonePattern` em contact_repository.dart), só que aceitando DDI sem "+" também — a canonicalização de verdade é assíncrona (fila), isto aqui só barra lixo óbvio. */
const PLAUSIBLE_PHONE_PATTERN = /^\+?\d{8,15}$/;

/**
 * Etapa 13 — motor de contatos (README raiz §5/6/13). Espelha
 * `ContactRepository` do front 1:1: `importContacts`/`addContact` criam
 * linhas PENDENTE de forma síncrona (mesmo contrato do mock — resposta
 * imediata) e enfileiram a verificação de verdade contra o WhatsApp em
 * `queue:validate-numbers`, que roda em segundo plano e atualiza
 * `status`/`normalizedPhone` mais tarde (ver `ValidateNumbersWorker`).
 */
@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: ValidateNumbersQueueService,
    private readonly sessionService: SessionService,
  ) {}

  async getContacts(userId: string): Promise<ContactDto[]> {
    const contacts = await this.prisma.withTenantContext(userId, (tx) =>
      tx.contact.findMany({ orderBy: { createdAt: 'asc' } }),
    );
    return contacts.map(toContactDto);
  }

  /** Espelha `importContacts(rawText)` — mesma regra de parsing do mock (telefone primeiro, resto vira ID1/ID2/…), só que persistindo de verdade e validando de verdade (assíncrono). */
  async importContacts(userId: string, rawText: string): Promise<ContactImportResultDto> {
    let imported = 0;
    let skipped = 0;
    const createdIds: string[] = [];

    for (const rawLine of rawText.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;

      const parts = line.split(',').map((part) => part.trim());
      const phone = (parts[0] ?? '').replace(/\s/g, '');

      if (!PLAUSIBLE_PHONE_PATTERN.test(phone)) {
        skipped++;
        continue;
      }

      const customFields: Record<string, string> = {};
      for (let i = 1; i < parts.length; i++) {
        if (parts[i]) customFields[`ID${i}`] = parts[i];
      }

      const contact = await this.prisma.withTenantContext(userId, (tx) =>
        tx.contact.create({ data: { userId, rawPhone: phone, customFields } }),
      );
      createdIds.push(contact.id);
      imported++;
    }

    if (imported > 0) {
      await this.incrementContactsImported(userId, imported);
      await Promise.all(createdIds.map((contactId) => this.queue.enqueue({ contactId, userId })));
    }

    return { contacts: await this.getContacts(userId), imported, skipped };
  }

  /** Espelha `addContact(phone, customFields)`. */
  async addContact(userId: string, phone: string, customFields: Record<string, string> = {}): Promise<ContactDto[]> {
    const cleanedPhone = this.assertPlausiblePhone(phone);

    const contact = await this.prisma.withTenantContext(userId, (tx) =>
      tx.contact.create({ data: { userId, rawPhone: cleanedPhone, customFields } }),
    );
    await this.incrementContactsImported(userId, 1);
    await this.queue.enqueue({ contactId: contact.id, userId });

    return this.getContacts(userId);
  }

  /** Espelha `updateContact(contact)` — mudar o telefone reabre a verificação (volta a PENDENTE e reenfileira); só editar `customFields` não reprocessa nada no WhatsApp. */
  async updateContact(
    userId: string,
    id: string,
    phone: string,
    customFields: Record<string, string> = {},
  ): Promise<ContactDto[]> {
    const existing = await this.prisma.withTenantContext(userId, (tx) => tx.contact.findUnique({ where: { id } }));
    if (!existing) {
      throw new NotFoundException('Contato não encontrado.');
    }

    const cleanedPhone = this.assertPlausiblePhone(phone);
    const phoneChanged = cleanedPhone !== existing.rawPhone;

    await this.prisma.withTenantContext(userId, (tx) =>
      tx.contact.update({
        where: { id },
        data: {
          rawPhone: cleanedPhone,
          customFields,
          ...(phoneChanged
            ? {
                status: 'PENDENTE' as const,
                normalizedPhone: null,
                attempts: 0,
                failureReason: null,
                verificationLog: [],
              }
            : {}),
        },
      }),
    );

    if (phoneChanged) {
      await this.queue.enqueue({ contactId: id, userId });
    }

    return this.getContacts(userId);
  }

  /** Espelha `removeContact(id)` — silenciosamente no-op se o id não existir (mesmo comportamento do mock: `removeWhere` não erra em item ausente). */
  async removeContact(userId: string, id: string): Promise<ContactDto[]> {
    await this.prisma.withTenantContext(userId, (tx) => tx.contact.deleteMany({ where: { id } }));
    return this.getContacts(userId);
  }

  private assertPlausiblePhone(phone: string): string {
    const cleaned = phone.replace(/\s/g, '');
    if (!PLAUSIBLE_PHONE_PATTERN.test(cleaned)) {
      throw new BadRequestException('Telefone inválido — use o formato internacional (ex.: +5511999999999).');
    }
    return cleaned;
  }

  /** `HomeStats.contactsImported` do front conta contatos recebidos, não só os validados (README §11/13) — incrementa aqui, na entrada, não no worker de verificação. */
  private async incrementContactsImported(userId: string, by: number): Promise<void> {
    await this.sessionService.getOrCreateSession(userId); // garante que a linha de Session já existe antes do update
    const updated = await this.prisma.withTenantContext(userId, (tx) =>
      tx.session.update({ where: { userId }, data: { contactsImported: { increment: by } } }),
    );
    this.sessionService.publishStats(userId, {
      contactsImported: updated.contactsImported,
      messagesSent: updated.messagesSent,
      messagesPending: updated.messagesPending,
      failures: updated.failures,
    });
  }
}

function toContactDto(contact: Contact): ContactDto {
  return {
    id: contact.id,
    phone: contact.normalizedPhone ? `+${contact.normalizedPhone}` : contact.rawPhone,
    customFields: (contact.customFields as Record<string, string> | null) ?? {},
    status: contact.status,
    failureReason: contact.failureReason,
  };
}
