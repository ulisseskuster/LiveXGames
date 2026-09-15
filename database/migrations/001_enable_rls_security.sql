-- =============================================================================
-- LIVEX GAMES - SUPABASE / POSTGRESQL ROW LEVEL SECURITY (RLS) MIGRATION
-- =============================================================================
-- Compatibilidade: PostgreSQL 14+ / Supabase 
-- Idempotente: Executável de forma segura em staging e produção
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. EXTENSÕES & AJUSTE ESTRUTURAL DE VINCULAÇÃO COM AUTH.USERS
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'auth_user_id'
  ) THEN
    ALTER TABLE public.users ADD COLUMN auth_user_id UUID UNIQUE;
    CREATE INDEX IF NOT EXISTS idx_users_auth_user_id ON public.users(auth_user_id);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. FUNÇÕES AUXILIARES DE AUTORIZAÇÃO (SECURITY DEFINER)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_current_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT id FROM public.users 
  WHERE auth_user_id = auth.uid() OR id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE (auth_user_id = auth.uid() OR id = auth.uid())
      AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_streamer()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE (auth_user_id = auth.uid() OR id = auth.uid())
      AND role IN ('streamer', 'admin')
  );
$$;

-- -----------------------------------------------------------------------------
-- 3. ÍNDICES DE PERFORMANCE PARA AS CLÁUSULAS DE POLÍTICAS RLS
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON public.wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_inventory_user_id ON public.user_inventory(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_donations_user_id ON public.donations(user_id);
CREATE INDEX IF NOT EXISTS idx_donations_streamer_id ON public.donations(streamer_id);
CREATE INDEX IF NOT EXISTS idx_flight_runs_user_id ON public.flight_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_streamer_rewards_streamer_id ON public.streamer_rewards(streamer_id);
CREATE INDEX IF NOT EXISTS idx_streamer_rewards_status ON public.streamer_rewards(status);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_user_id ON public.reward_redemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_streamer_id ON public.reward_redemptions(streamer_id);
CREATE INDEX IF NOT EXISTS idx_streamer_wallets_user_id ON public.streamer_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_streamer_wallets_streamer_id ON public.streamer_wallets(streamer_id);
CREATE INDEX IF NOT EXISTS idx_streamer_wallet_tx_user_id ON public.streamer_wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_streamer_wallet_tx_streamer_id ON public.streamer_wallet_transactions(streamer_id);
CREATE INDEX IF NOT EXISTS idx_streamer_applications_applicant_id ON public.streamer_applications(applicant_id);
CREATE INDEX IF NOT EXISTS idx_roulette_spins_user_date ON public.streamer_roulette_spins(user_id, streamer_id, spin_date);

-- -----------------------------------------------------------------------------
-- 4. HABILITAÇÃO DO ROW LEVEL SECURITY (14 TABELAS)
-- -----------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flight_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streamer_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streamer_payment_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streamer_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streamer_wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streamer_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streamer_roulette_spins ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 5. POLÍTICAS RLS (DROP PREVENTIVO + CREATE ESPECÍFICO)
-- -----------------------------------------------------------------------------

-- TABELA 1: public.users
DROP POLICY IF EXISTS "users_select_policy" ON public.users;
DROP POLICY IF EXISTS "users_update_policy" ON public.users;

CREATE POLICY "users_select_policy" ON public.users
  FOR SELECT
  TO authenticated, anon
  USING (
    role IN ('streamer', 'admin') 
    OR id = public.get_current_user_id() 
    OR public.is_admin()
  );

CREATE POLICY "users_update_policy" ON public.users
  FOR UPDATE
  TO authenticated
  USING (id = public.get_current_user_id() OR public.is_admin())
  WITH CHECK (id = public.get_current_user_id() OR public.is_admin());

CREATE OR REPLACE FUNCTION public.protect_user_critical_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    NEW.role := OLD.role;
    NEW.lives := OLD.lives;
    NEW.max_lives := OLD.max_lives;
    NEW.is_sub_twitch := OLD.is_sub_twitch;
    NEW.is_sub_kick := OLD.is_sub_kick;
    NEW.auth_user_id := OLD.auth_user_id;
    NEW.password_hash := OLD.password_hash;
    NEW.email := OLD.email;
    NEW.username := OLD.username;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_user_columns ON public.users;
CREATE TRIGGER trg_protect_user_columns
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_user_critical_columns();

-- TABELA 2: public.wallets
DROP POLICY IF EXISTS "wallets_select_own" ON public.wallets;
CREATE POLICY "wallets_select_own" ON public.wallets
  FOR SELECT
  TO authenticated
  USING (user_id = public.get_current_user_id() OR public.is_admin());

-- TABELA 3: public.user_inventory
DROP POLICY IF EXISTS "inventory_select_own" ON public.user_inventory;
CREATE POLICY "inventory_select_own" ON public.user_inventory
  FOR SELECT
  TO authenticated
  USING (user_id = public.get_current_user_id() OR public.is_admin());

-- TABELA 4: public.shop_items
DROP POLICY IF EXISTS "shop_items_select_public" ON public.shop_items;
DROP POLICY IF EXISTS "shop_items_admin_insert" ON public.shop_items;
DROP POLICY IF EXISTS "shop_items_admin_update" ON public.shop_items;
DROP POLICY IF EXISTS "shop_items_admin_delete" ON public.shop_items;

CREATE POLICY "shop_items_select_public" ON public.shop_items
  FOR SELECT
  TO authenticated, anon
  USING (is_active = true OR public.is_admin());

CREATE POLICY "shop_items_admin_insert" ON public.shop_items
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "shop_items_admin_update" ON public.shop_items
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "shop_items_admin_delete" ON public.shop_items
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- TABELA 5: public.transactions
DROP POLICY IF EXISTS "transactions_select_own" ON public.transactions;
CREATE POLICY "transactions_select_own" ON public.transactions
  FOR SELECT
  TO authenticated
  USING (user_id = public.get_current_user_id() OR public.is_admin());

-- TABELA 6: public.donations
DROP POLICY IF EXISTS "donations_select_related" ON public.donations;
CREATE POLICY "donations_select_related" ON public.donations
  FOR SELECT
  TO authenticated
  USING (
    user_id = public.get_current_user_id() 
    OR streamer_id = public.get_current_user_id() 
    OR public.is_admin()
  );

-- TABELA 7: public.flight_runs
DROP POLICY IF EXISTS "flight_runs_select_all" ON public.flight_runs;
CREATE POLICY "flight_runs_select_all" ON public.flight_runs
  FOR SELECT
  TO authenticated, anon
  USING (true);

-- TABELA 8: public.streamer_rewards
DROP POLICY IF EXISTS "rewards_select_policy" ON public.streamer_rewards;
DROP POLICY IF EXISTS "rewards_insert_streamer" ON public.streamer_rewards;
DROP POLICY IF EXISTS "rewards_update_policy" ON public.streamer_rewards;
DROP POLICY IF EXISTS "rewards_delete_policy" ON public.streamer_rewards;

CREATE POLICY "rewards_select_policy" ON public.streamer_rewards
  FOR SELECT
  TO authenticated, anon
  USING (
    (status = 'approved')
    OR (streamer_id = public.get_current_user_id())
    OR public.is_admin()
  );

CREATE POLICY "rewards_insert_streamer" ON public.streamer_rewards
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (streamer_id = public.get_current_user_id() AND public.is_streamer() AND status = 'pending')
    OR public.is_admin()
  );

CREATE POLICY "rewards_update_policy" ON public.streamer_rewards
  FOR UPDATE
  TO authenticated
  USING (
    (streamer_id = public.get_current_user_id() AND status IN ('pending', 'rejected'))
    OR public.is_admin()
  )
  WITH CHECK (
    (streamer_id = public.get_current_user_id() AND status = 'pending')
    OR public.is_admin()
  );

CREATE POLICY "rewards_delete_policy" ON public.streamer_rewards
  FOR DELETE
  TO authenticated
  USING (
    (streamer_id = public.get_current_user_id() AND status IN ('pending', 'rejected', 'inactive'))
    OR public.is_admin()
  );

-- TABELA 9: public.reward_redemptions
DROP POLICY IF EXISTS "redemptions_select_policy" ON public.reward_redemptions;
DROP POLICY IF EXISTS "redemptions_update_streamer" ON public.reward_redemptions;

CREATE POLICY "redemptions_select_policy" ON public.reward_redemptions
  FOR SELECT
  TO authenticated
  USING (
    user_id = public.get_current_user_id()
    OR streamer_id = public.get_current_user_id()
    OR public.is_admin()
  );

CREATE POLICY "redemptions_update_streamer" ON public.reward_redemptions
  FOR UPDATE
  TO authenticated
  USING (
    streamer_id = public.get_current_user_id()
    OR public.is_admin()
  )
  WITH CHECK (
    streamer_id = public.get_current_user_id()
    OR public.is_admin()
  );

-- TABELA 10: public.streamer_payment_configs
DROP POLICY IF EXISTS "payment_configs_block_anon" ON public.streamer_payment_configs;
DROP POLICY IF EXISTS "payment_configs_select_owner" ON public.streamer_payment_configs;
DROP POLICY IF EXISTS "payment_configs_update_owner" ON public.streamer_payment_configs;

CREATE POLICY "payment_configs_select_owner" ON public.streamer_payment_configs
  FOR SELECT
  TO authenticated
  USING (streamer_id = public.get_current_user_id() OR public.is_admin());

CREATE POLICY "payment_configs_update_owner" ON public.streamer_payment_configs
  FOR UPDATE
  TO authenticated
  USING (streamer_id = public.get_current_user_id() OR public.is_admin())
  WITH CHECK (streamer_id = public.get_current_user_id() OR public.is_admin());

CREATE OR REPLACE VIEW public.streamer_payment_configs_public AS
SELECT 
  id,
  streamer_id,
  pixgg_client_id,
  livepix_client_id,
  CASE WHEN livepix_webhook_secret IS NOT NULL THEN 'configured' ELSE 'missing' END AS livepix_status,
  CASE WHEN pixgg_webhook_secret IS NOT NULL THEN 'configured' ELSE 'missing' END AS pixgg_status,
  created_at,
  updated_at
FROM public.streamer_payment_configs;

-- TABELA 11: public.streamer_wallets
DROP POLICY IF EXISTS "streamer_wallets_select" ON public.streamer_wallets;
CREATE POLICY "streamer_wallets_select" ON public.streamer_wallets
  FOR SELECT
  TO authenticated
  USING (
    user_id = public.get_current_user_id()
    OR streamer_id = public.get_current_user_id()
    OR public.is_admin()
  );

-- TABELA 12: public.streamer_wallet_transactions
DROP POLICY IF EXISTS "streamer_wallet_tx_select" ON public.streamer_wallet_transactions;
CREATE POLICY "streamer_wallet_tx_select" ON public.streamer_wallet_transactions
  FOR SELECT
  TO authenticated
  USING (
    user_id = public.get_current_user_id()
    OR streamer_id = public.get_current_user_id()
    OR public.is_admin()
  );

-- TABELA 13: public.streamer_applications
DROP POLICY IF EXISTS "applications_select_policy" ON public.streamer_applications;
DROP POLICY IF EXISTS "applications_insert_policy" ON public.streamer_applications;
DROP POLICY IF EXISTS "applications_admin_update" ON public.streamer_applications;

CREATE POLICY "applications_select_policy" ON public.streamer_applications
  FOR SELECT
  TO authenticated
  USING (applicant_id = public.get_current_user_id() OR public.is_admin());

CREATE POLICY "applications_insert_policy" ON public.streamer_applications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    applicant_id = public.get_current_user_id()
    AND status = 'pending'
  );

CREATE POLICY "applications_admin_update" ON public.streamer_applications
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- TABELA 14: public.streamer_roulette_spins
DROP POLICY IF EXISTS "roulette_spins_select_policy" ON public.streamer_roulette_spins;
CREATE POLICY "roulette_spins_select_policy" ON public.streamer_roulette_spins
  FOR SELECT
  TO authenticated
  USING (
    user_id = public.get_current_user_id()
    OR streamer_id = public.get_current_user_id()
    OR public.is_admin()
  );

-- -----------------------------------------------------------------------------
-- 6. REVISÃO E REVOGAÇÃO DE PRIVILÉGIOS (LEAST PRIVILEGE)
-- -----------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.wallets FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.streamer_wallets FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.transactions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.streamer_wallet_transactions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.donations FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.flight_runs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.streamer_roulette_spins FROM anon, authenticated;

REVOKE ALL ON public.streamer_payment_configs FROM anon;

COMMIT;
