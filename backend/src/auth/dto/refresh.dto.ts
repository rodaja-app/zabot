import { IsString, MinLength } from 'class-validator';

export class RefreshDto {
  @IsString()
  @MinLength(10, { message: 'Refresh token inválido.' })
  refreshToken!: string;
}
