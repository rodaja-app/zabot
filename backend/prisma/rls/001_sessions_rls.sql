-- Etapa 11 — Row-Level Security para as tabelas "sessions" e
-- "session_auth_keys" (ver comentário do model Session em schema.prisma).
--
-- O Prisma não tem sintaxe para RLS no schema.prisma, então esta política
-- vive como SQL puro, aplicada uma vez, depois que as tabelas já existem:
--
--   1. npx prisma migrate dev   (cria/atualiza as tabelas a partir do schema)
--   2. npx prisma db execute --file prisma/rls/001_sessions_rls.sql --schema prisma/schema.prisma
--
-- Idempotente (DROP POLICY IF EXISTS antes de recriar) — seguro rodar de
-- novo depois de um `migrate reset` em dev.
--
-- FORCE ROW LEVEL SECURITY é necessário porque, no Railway/Postgres
-- gerenciado, o usuário da própria aplicação normalmente é o *dono* das
-- tabelas que ele mesmo migrou — e donos de tabela ignoram RLS por padrão
-- (ENABLE sozinho não bastaria, a política simplesmente não seria checada
-- nas queries da própria API).
--
-- app.current_user_id é setado por PrismaService.withTenantContext() via
-- set_config(..., true) escopado à transação atual (ver prisma.service.ts).
-- Fora de uma transação com esse contexto, current_setting(..., true) volta
-- NULL — nenhuma linha bate a política, ou seja, o padrão é negar acesso,
-- não vazar tudo.

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "sessions";
CREATE POLICY tenant_isolation ON "sessions"
  USING ("userId" = current_setting('app.current_user_id', true))
  WITH CHECK ("userId" = current_setting('app.current_user_id', true));

ALTER TABLE "session_auth_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session_auth_keys" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "session_auth_keys";
CREATE POLICY tenant_isolation ON "session_auth_keys"
  USING ("userId" = current_setting('app.current_user_id', true))
  WITH CHECK ("userId" = current_setting('app.current_user_id', true));
