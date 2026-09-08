import { IsOptional, IsString, Matches } from 'class-validator';

/**
 * Corpo do POST /whatsapp/session/connect. `phoneNumber` ausente = fluxo QR
 * code; presente = fluxo de pareamento por código (ver
 * `ConnectionRepository.connect({phoneNumber})` no front). Regex aceita só
 * dígitos e os separadores comuns de digitação (o provider já normaliza para
 * dígitos puros antes de repassar ao Baileys — ver baileys-whatsapp.provider.ts).
 */
export class ConnectSessionDto {
  @IsOptional()
  @IsString()
  @Matches(/^[\d\s()+-]{8,20}$/, { message: 'Número de telefone inválido.' })
  phoneNumber?: string;
}
