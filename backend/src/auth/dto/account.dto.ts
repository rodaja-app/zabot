/**
 * Formato de resposta de `GET /auth/me` — mapeia 1:1 para `UserAccount`
 * (`lib/data/models/user_account.dart`), consumido por `MenuRepository.getAccount()`.
 * Etapa 18 (integração final): não existia rota de perfil até aqui porque
 * nenhuma etapa de backend precisava dela — só a `ApiMenuRepository` real.
 */
export interface AccountDto {
  name: string;
  email: string;
}
