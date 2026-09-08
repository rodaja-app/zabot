-- Etapa 16 — Row-Level Security para as tabelas de assinatura por usuário
-- (ver comentários dos models Subscription/PaymentHistoryEntry em
-- schema.prisma). Mesmo padrão de 001_sessions_rls.sql/002_proxy_config_rls.sql/
-- 003_contacts_rls.sql/004_campaigns_rls.sql — ver aquele arquivo para a
-- explicação de FORCE ROW LEVEL SECURITY e de app.current_user_id.
--
-- "plans" (catálogo global) e "revenuecat_events" (guarda de idempotência
-- técnica) NÃO entram aqui de propósito — ver comentário dos respectivos
-- models em schema.prisma para o motivo de cada isenção.
--
--   1. npx prisma migrate dev
--   2. npx prisma db execute --file prisma/rls/005_plans_rls.sql --schema prisma/schema.prisma
--
-- Idempotente (DROP POLICY IF EXISTS antes de recriar).

ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "subscriptions";
CREATE POLICY tenant_isolation ON "subscriptions"
  USING ("userId" = current_setting('app.current_user_id', true))
  WITH CHECK ("userId" = current_setting('app.current_user_id', true));

ALTER TABLE "payment_history_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_history_entries" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "payment_history_entries";
CREATE POLICY tenant_isolation ON "payment_history_entries"
  USING ("userId" = current_setting('app.current_user_id', true))
  WITH CHECK ("userId" = current_setting('app.current_user_id', true));
