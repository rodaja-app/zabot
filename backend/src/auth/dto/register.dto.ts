import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(2, { message: 'Nome deve ter ao menos 2 caracteres.' })
  @MaxLength(120)
  name!: string;

  @IsEmail({}, { message: 'Email inválido.' })
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Senha deve ter ao menos 8 caracteres.' })
  @MaxLength(128)
  password!: string;
}
