-- Etapa 17 — Row-Level Security para a tabela "user_settings" (ver
-- comentário do model UserSettings em schema.prisma). Mesmo padrão de
-- 001_sessions_rls.sql/002_proxy_config_rls.sql — ver aquele arquivo para a
-- explicação de FORCE ROW LEVEL SECURITY e de app.current_user_id.
--
--   1. npx prisma migrate dev
--   2. npx prisma db execute --file prisma/rls/006_user_settings_rls.sql --schema prisma/schema.prisma
--
-- Idempotente (DROP POLICY IF EXISTS antes de recriar).

ALTER TABLE "user_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_settings" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "user_settings";
CREATE POLICY tenant_isolation ON "user_settings"
  USING ("userId" = current_setting('app.current_user_id', true))
  WITH CHECK ("userId" = current_setting('app.current_user_id', true));
