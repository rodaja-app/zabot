import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Corpo do `POST /campaigns` — espelha `createCampaign(messages, recipientCount,
 * mediaType, mediaCount)` do front, mas com duas extensões deliberadas que o
 * mock não tem (ver backend/README.md "Etapa 14"):
 *
 *  - `mediaIds`: referencia uploads já feitos via `POST /campaigns/media`
 *    (a mídia real não cabe no contrato mockado, que só carrega um enum +
 *    contagem); `mediaType`/`mediaCount` da campanha são sempre derivados
 *    daqui, nunca recebidos direto do cliente.
 *  - `recipientIds`: quando presente e não vazio, envia só para estes
 *    contatos (deve ter `Contact.status = VALIDO`); omitido ou vazio =
 *    "todos" (todos os contatos VALIDO do usuário) — cobre os dois modos
 *    ("todos" / "específicos") do README raiz §13 que o mock só simula com
 *    um `recipientCount` agregado.
 */
export class CreateCampaignDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Campanha precisa de ao menos 1 mensagem.' })
  @ArrayMaxSize(5, { message: 'Campanha aceita no máximo 5 mensagens.' })
  @IsString({ each: true })
  @MinLength(1, { each: true, message: 'Mensagem não pode ser vazia.' })
  @MaxLength(4096, { each: true, message: 'Mensagem excede o tamanho máximo permitido (4096 caracteres).' })
  messages!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  recipientIds?: string[];
}
