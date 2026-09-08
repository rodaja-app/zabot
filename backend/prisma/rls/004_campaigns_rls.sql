-- Etapa 14 — Row-Level Security para as 5 tabelas de campanhas (ver
-- comentários dos models Campaign/CampaignMessage/CampaignMedia/
-- CampaignRecipient/Envio em schema.prisma). Mesmo padrão de
-- 001_sessions_rls.sql/002_proxy_config_rls.sql/003_contacts_rls.sql — ver
-- aquele arquivo para a explicação de FORCE ROW LEVEL SECURITY e de
-- app.current_user_id.
--
--   1. npx prisma migrate dev
--   2. npx prisma db execute --file prisma/rls/004_campaigns_rls.sql --schema prisma/schema.prisma
--
-- Idempotente (DROP POLICY IF EXISTS antes de recriar).

ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaigns" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "campaigns";
CREATE POLICY tenant_isolation ON "campaigns"
  USING ("userId" = current_setting('app.current_user_id', true))
  WITH CHECK ("userId" = current_setting('app.current_user_id', true));

ALTER TABLE "campaign_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaign_messages" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "campaign_messages";
CREATE POLICY tenant_isolation ON "campaign_messages"
  USING ("userId" = current_setting('app.current_user_id', true))
  WITH CHECK ("userId" = current_setting('app.current_user_id', true));

ALTER TABLE "campaign_media" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaign_media" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "campaign_media";
CREATE POLICY tenant_isolation ON "campaign_media"
  USING ("userId" = current_setting('app.current_user_id', true))
  WITH CHECK ("userId" = current_setting('app.current_user_id', true));

ALTER TABLE "campaign_recipients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaign_recipients" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "campaign_recipients";
CREATE POLICY tenant_isolation ON "campaign_recipients"
  USING ("userId" = current_setting('app.current_user_id', true))
  WITH CHECK ("userId" = current_setting('app.current_user_id', true));

ALTER TABLE "envios" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "envios" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "envios";
CREATE POLICY tenant_isolation ON "envios"
  USING ("userId" = current_setting('app.current_user_id', true))
  WITH CHECK ("userId" = current_setting('app.current_user_id', true));
