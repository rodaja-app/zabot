/** Formato de resposta dos endpoints que emitem sessão (confirm-code, login, refresh). */
export interface AuthTokensDto {
  accessToken: string;
  refreshToken: string;
}
