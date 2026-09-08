import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';

/** Corpo comum de POST /contacts e PATCH /contacts/:id — espelha `addContact(phone, customFields)`/`updateContact(contact)` do front. */
export class UpsertContactDto {
  @IsString()
  @MinLength(1, { message: 'Telefone é obrigatório.' })
  phone!: string;

  @IsOptional()
  @IsObject()
  customFields?: Record<string, string>;
}
