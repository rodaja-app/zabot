-- Etapa 13 — Row-Level Security para a tabela "contacts" (ver comentário
-- do model Contact em schema.prisma). Mesmo padrão de
-- 001_sessions_rls.sql/002_proxy_config_rls.sql — ver aquele arquivo para a
-- explicação de FORCE ROW LEVEL SECURITY e de app.current_user_id.
--
--   1. npx prisma migrate dev
--   2. npx prisma db execute --file prisma/rls/003_contacts_rls.sql --schema prisma/schema.prisma
--
-- Idempotente (DROP POLICY IF EXISTS antes de recriar).

ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contacts";
CREATE POLICY tenant_isolation ON "contacts"
  USING ("userId" = current_setting('app.current_user_id', true))
  WITH CHECK ("userId" = current_setting('app.current_user_id', true));
