-- Etapa 12 — Row-Level Security para a tabela "proxy_configs" (ver comentário
-- do model ProxyConfig em schema.prisma). Mesmo padrão de
-- 001_sessions_rls.sql — ver aquele arquivo para a explicação de
-- FORCE ROW LEVEL SECURITY e de app.current_user_id.
--
--   1. npx prisma migrate dev
--   2. npx prisma db execute --file prisma/rls/002_proxy_config_rls.sql --schema prisma/schema.prisma
--
-- Idempotente (DROP POLICY IF EXISTS antes de recriar).

ALTER TABLE "proxy_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proxy_configs" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "proxy_configs";
CREATE POLICY tenant_isolation ON "proxy_configs"
  USING ("userId" = current_setting('app.current_user_id', true))
  WITH CHECK ("userId" = current_setting('app.current_user_id', true));
