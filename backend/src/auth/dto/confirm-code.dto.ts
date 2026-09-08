import { IsEmail, Matches, MaxLength } from 'class-validator';

export class ConfirmCodeDto {
  @IsEmail({}, { message: 'Email inválido.' })
  @MaxLength(255)
  email!: string;

  @Matches(/^\d{6}$/, { message: 'Código deve conter exatamente 6 dígitos.' })
  code!: string;
}
