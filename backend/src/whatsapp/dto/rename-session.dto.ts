import { IsString, MaxLength, MinLength } from 'class-validator';

export class RenameSessionDto {
  @IsString()
  @MinLength(1, { message: 'Nome da sessão é obrigatório.' })
  @MaxLength(120)
  name!: string;
}
