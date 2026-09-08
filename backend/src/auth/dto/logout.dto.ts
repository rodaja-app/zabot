import { IsOptional, IsString } from 'class-validator';

/**
 * `refreshToken` é opcional: logout é best-effort (ver AuthService.logout) —
 * mesmo sem token (ou com um já expirado/inválido), a resposta é sempre
 * sucesso, porque o efeito que importa (cliente esquece a sessão local) não
 * depende do backend revogar algo que já não existe mais.
 */
export class LogoutDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
