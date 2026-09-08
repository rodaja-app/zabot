import { IsEmail, MaxLength } from 'class-validator';

export class ResendCodeDto {
  @IsEmail({}, { message: 'Email inválido.' })
  @MaxLength(255)
  email!: string;
}
