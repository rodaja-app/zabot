import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ContactsService } from './contacts.service';
import { ContactDto, ContactImportResultDto } from './dto/contact.dto';
import { ImportContactsDto } from './dto/import-contacts.dto';
import { UpsertContactDto } from './dto/upsert-contact.dto';

/** Rotas mapeadas 1:1 com `ContactRepository` do front (README §13). */
@UseGuards(JwtAuthGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  getContacts(@CurrentUserId() userId: string): Promise<ContactDto[]> {
    return this.contactsService.getContacts(userId);
  }

  @Post('import')
  importContacts(
    @CurrentUserId() userId: string,
    @Body() dto: ImportContactsDto,
  ): Promise<ContactImportResultDto> {
    return this.contactsService.importContacts(userId, dto.rawText);
  }

  @Post()
  addContact(@CurrentUserId() userId: string, @Body() dto: UpsertContactDto): Promise<ContactDto[]> {
    return this.contactsService.addContact(userId, dto.phone, dto.customFields);
  }

  @Patch(':id')
  updateContact(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: UpsertContactDto,
  ): Promise<ContactDto[]> {
    return this.contactsService.updateContact(userId, id, dto.phone, dto.customFields);
  }

  @Delete(':id')
  removeContact(@CurrentUserId() userId: string, @Param('id') id: string): Promise<ContactDto[]> {
    return this.contactsService.removeContact(userId, id);
  }
}
