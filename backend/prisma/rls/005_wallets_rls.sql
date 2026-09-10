-- Row-Level Security para a carteira de créditos por usuário (ver
-- comentários dos models Wallet/WalletTransaction em schema.prisma). Mesmo
-- padrão de 001_sessions_rls.sql/002_proxy_config_rls.sql/003_contacts_rls.sql/
-- 004_campaigns_rls.sql — ver aquele arquivo para a explicação de FORCE ROW
-- LEVEL SECURITY e de app.current_user_id.
--
--   1. npx prisma migrate dev
--   2. npx prisma db execute --file prisma/rls/005_wallets_rls.sql --schema prisma/schema.prisma
--
-- Idempotente (DROP POLICY IF EXISTS antes de recriar).

ALTER TABLE "wallets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wallets" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "wallets";
CREATE POLICY tenant_isolation ON "wallets"
  USING ("userId" = current_setting('app.current_user_id', true))
  WITH CHECK ("userId" = current_setting('app.current_user_id', true));

ALTER TABLE "wallet_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wallet_transactions" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "wallet_transactions";
CREATE POLICY tenant_isolation ON "wallet_transactions"
  USING ("userId" = current_setting('app.current_user_id', true))
  WITH CHECK ("userId" = current_setting('app.current_user_id', true));
