import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Email inválido.' })
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Senha é obrigatória.' })
  @MaxLength(128)
  password!: string;
}
