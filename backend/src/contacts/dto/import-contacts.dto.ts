import { IsString, MinLength } from 'class-validator';

/** Corpo do POST /contacts/import — mesmo texto colado que `ContactRepository.importContacts(rawText)` recebe no front. */
export class ImportContactsDto {
  @IsString()
  @MinLength(1, { message: 'Texto para importação não pode ser vazio.' })
  rawText!: string;
}
