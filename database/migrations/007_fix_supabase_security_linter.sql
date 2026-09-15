-- =============================================================================
-- LIVEX GAMES - MIGRAÇÃO 007: HARDENING COMPLETO DO SUPABASE DATABASE LINTER
-- =============================================================================
--
-- Resolve 10 warnings do Security Advisor + 1 ação manual (Leaked Passwords):
--
--   ✅ function_search_path_mutable       (protect_user_critical_columns)
--   ✅ anon_security_definer_function_executable  (4 funções)
--   ✅ authenticated_security_definer_function_executable (4 funções)
--   ✅ security_definer_view              (streamer_payment_configs_public)
--   ⚠️ auth_leaked_password_protection    (requer ação manual no Dashboard)
--
-- ESTRATÉGIA:
--   Mover get_current_user_id(), is_admin(), is_streamer() e
--   protect_user_critical_columns() para o schema "private", que NÃO é
--   exposto pelo PostgREST. Isso elimina os endpoints /rest/v1/rpc/* sem
--   quebrar nenhuma policy RLS nem o trigger, pois:
--     • Policies referenciam as funções pelo schema qualificado (private.*)
--     • O EXECUTE é concedido apenas aos roles que precisam
--     • PostgREST só expõe schemas listados em pgrst.db-schemas (padrão: public)
--
-- IDEMPOTENTE: seguro para executar múltiplas vezes.
-- ATÔMICA: BEGIN/COMMIT — tudo ou nada.
-- =============================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- ETAPA 1: CRIAR SCHEMA PRIVADO (NÃO EXPOSTO PELO POSTGREST)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE SCHEMA IF NOT EXISTS private;

-- Conceder USAGE para que anon/authenticated possam chamar funções dentro
-- deste schema (necessário para avaliação de policies RLS), mas sem que
-- o PostgREST exponha endpoints RPC.
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ETAPA 2: RECRIAR FUNÇÕES NO SCHEMA PRIVATE COM SEARCH_PATH SEGURO
-- ═══════════════════════════════════════════════════════════════════════════

-- 2.1 get_current_user_id()
-- Usada por 25 policies RLS. DEVE permanecer SECURITY DEFINER porque precisa
-- ler public.users bypassing RLS (evita dependência circular com users_select_policy).
CREATE OR REPLACE FUNCTION private.get_current_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id FROM public.users
  WHERE auth_user_id = auth.uid() OR id = auth.uid()
  LIMIT 1;
$$;

-- 2.2 is_admin()
-- Usada por 24 policies e pelo trigger protect_user_critical_columns().
CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE (auth_user_id = auth.uid() OR id = auth.uid())
      AND role = 'admin'
  );
$$;

-- 2.3 is_streamer()
-- Usada por 1 policy (rewards_insert_streamer).
CREATE OR REPLACE FUNCTION private.is_streamer()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE (auth_user_id = auth.uid() OR id = auth.uid())
      AND role IN ('streamer', 'admin')
  );
$$;

-- 2.4 protect_user_critical_columns()
-- Trigger function — NENHUM role precisa de EXECUTE direto.
CREATE OR REPLACE FUNCTION private.protect_user_critical_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.is_admin() THEN
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

-- ═══════════════════════════════════════════════════════════════════════════
-- ETAPA 3: CONFIGURAR PRIVILÉGIOS MÍNIMOS NAS FUNÇÕES PRIVATE
-- ═══════════════════════════════════════════════════════════════════════════

-- Revogar EXECUTE do PUBLIC default para todas as 4 funções
REVOKE EXECUTE ON FUNCTION private.get_current_user_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.is_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.is_streamer() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.protect_user_critical_columns() FROM PUBLIC;

-- Conceder EXECUTE apenas aos roles que precisam para avaliação de policies
GRANT EXECUTE ON FUNCTION private.get_current_user_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_admin() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_streamer() TO authenticated, service_role;

-- protect_user_critical_columns(): NÃO conceder a ninguém.
-- Trigger functions são invocadas pelo engine do PostgreSQL, não pelo usuário.
-- O trigger roda com as permissões do SECURITY DEFINER (owner), independente
-- de quem disparou o UPDATE.

-- ═══════════════════════════════════════════════════════════════════════════
-- ETAPA 4: ATUALIZAR TRIGGER PARA REFERENCIAR PRIVATE.*
-- ═══════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_protect_user_columns ON public.users;
CREATE TRIGGER trg_protect_user_columns
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_user_critical_columns();

-- ═══════════════════════════════════════════════════════════════════════════
-- ETAPA 5: RECRIAR TODAS AS POLICIES RLS REFERENCIANDO PRIVATE.*
-- ═══════════════════════════════════════════════════════════════════════════
-- Ordem: DROP preventivo → CREATE com referências atualizadas
-- Cada bloco corresponde a uma tabela da migração 001.

-- ─── TABELA 1: public.users ─────────────────────────────────────────────
DROP POLICY IF EXISTS "users_select_policy" ON public.users;
DROP POLICY IF EXISTS "users_update_policy" ON public.users;

CREATE POLICY "users_select_policy" ON public.users
  FOR SELECT
  TO authenticated, anon
  USING (
    role IN ('streamer', 'admin')
    OR id = private.get_current_user_id()
    OR private.is_admin()
  );

CREATE POLICY "users_update_policy" ON public.users
  FOR UPDATE
  TO authenticated
  USING (id = private.get_current_user_id() OR private.is_admin())
  WITH CHECK (id = private.get_current_user_id() OR private.is_admin());

-- ─── TABELA 2: public.wallets ───────────────────────────────────────────
DROP POLICY IF EXISTS "wallets_select_own" ON public.wallets;
CREATE POLICY "wallets_select_own" ON public.wallets
  FOR SELECT
  TO authenticated
  USING (user_id = private.get_current_user_id() OR private.is_admin());

-- ─── TABELA 3: public.user_inventory ────────────────────────────────────
DROP POLICY IF EXISTS "inventory_select_own" ON public.user_inventory;
CREATE POLICY "inventory_select_own" ON public.user_inventory
  FOR SELECT
  TO authenticated
  USING (user_id = private.get_current_user_id() OR private.is_admin());

-- ─── TABELA 4: public.shop_items ────────────────────────────────────────
DROP POLICY IF EXISTS "shop_items_select_public" ON public.shop_items;
DROP POLICY IF EXISTS "shop_items_admin_insert" ON public.shop_items;
DROP POLICY IF EXISTS "shop_items_admin_update" ON public.shop_items;
DROP POLICY IF EXISTS "shop_items_admin_delete" ON public.shop_items;

CREATE POLICY "shop_items_select_public" ON public.shop_items
  FOR SELECT
  TO authenticated, anon
  USING (is_active = true OR private.is_admin());

CREATE POLICY "shop_items_admin_insert" ON public.shop_items
  FOR INSERT
  TO authenticated
  WITH CHECK (private.is_admin());

CREATE POLICY "shop_items_admin_update" ON public.shop_items
  FOR UPDATE
  TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

CREATE POLICY "shop_items_admin_delete" ON public.shop_items
  FOR DELETE
  TO authenticated
  USING (private.is_admin());

-- ─── TABELA 5: public.transactions ──────────────────────────────────────
DROP POLICY IF EXISTS "transactions_select_own" ON public.transactions;
CREATE POLICY "transactions_select_own" ON public.transactions
  FOR SELECT
  TO authenticated
  USING (user_id = private.get_current_user_id() OR private.is_admin());

-- ─── TABELA 6: public.donations ─────────────────────────────────────────
DROP POLICY IF EXISTS "donations_select_related" ON public.donations;
CREATE POLICY "donations_select_related" ON public.donations
  FOR SELECT
  TO authenticated
  USING (
    user_id = private.get_current_user_id()
    OR streamer_id = private.get_current_user_id()
    OR private.is_admin()
  );

-- ─── TABELA 7: public.flight_runs (sem funções — inalterada) ────────────
-- flight_runs_select_all usa USING (true), sem referências a funções.
-- Nenhuma alteração necessária.

-- ─── TABELA 8: public.streamer_rewards ──────────────────────────────────
DROP POLICY IF EXISTS "rewards_select_policy" ON public.streamer_rewards;
DROP POLICY IF EXISTS "rewards_insert_streamer" ON public.streamer_rewards;
DROP POLICY IF EXISTS "rewards_update_policy" ON public.streamer_rewards;
DROP POLICY IF EXISTS "rewards_delete_policy" ON public.streamer_rewards;

CREATE POLICY "rewards_select_policy" ON public.streamer_rewards
  FOR SELECT
  TO authenticated, anon
  USING (
    (status = 'approved')
    OR (streamer_id = private.get_current_user_id())
    OR private.is_admin()
  );

CREATE POLICY "rewards_insert_streamer" ON public.streamer_rewards
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (streamer_id = private.get_current_user_id() AND private.is_streamer() AND status = 'pending')
    OR private.is_admin()
  );

CREATE POLICY "rewards_update_policy" ON public.streamer_rewards
  FOR UPDATE
  TO authenticated
  USING (
    (streamer_id = private.get_current_user_id() AND status IN ('pending', 'rejected'))
    OR private.is_admin()
  )
  WITH CHECK (
    (streamer_id = private.get_current_user_id() AND status = 'pending')
    OR private.is_admin()
  );

CREATE POLICY "rewards_delete_policy" ON public.streamer_rewards
  FOR DELETE
  TO authenticated
  USING (
    (streamer_id = private.get_current_user_id() AND status IN ('pending', 'rejected', 'inactive'))
    OR private.is_admin()
  );

-- ─── TABELA 9: public.reward_redemptions ────────────────────────────────
DROP POLICY IF EXISTS "redemptions_select_policy" ON public.reward_redemptions;
DROP POLICY IF EXISTS "redemptions_update_streamer" ON public.reward_redemptions;

CREATE POLICY "redemptions_select_policy" ON public.reward_redemptions
  FOR SELECT
  TO authenticated
  USING (
    user_id = private.get_current_user_id()
    OR streamer_id = private.get_current_user_id()
    OR private.is_admin()
  );

CREATE POLICY "redemptions_update_streamer" ON public.reward_redemptions
  FOR UPDATE
  TO authenticated
  USING (
    streamer_id = private.get_current_user_id()
    OR private.is_admin()
  )
  WITH CHECK (
    streamer_id = private.get_current_user_id()
    OR private.is_admin()
  );

-- ─── TABELA 10: public.streamer_payment_configs ─────────────────────────
DROP POLICY IF EXISTS "payment_configs_select_owner" ON public.streamer_payment_configs;
DROP POLICY IF EXISTS "payment_configs_update_owner" ON public.streamer_payment_configs;

CREATE POLICY "payment_configs_select_owner" ON public.streamer_payment_configs
  FOR SELECT
  TO authenticated
  USING (streamer_id = private.get_current_user_id() OR private.is_admin());

CREATE POLICY "payment_configs_update_owner" ON public.streamer_payment_configs
  FOR UPDATE
  TO authenticated
  USING (streamer_id = private.get_current_user_id() OR private.is_admin())
  WITH CHECK (streamer_id = private.get_current_user_id() OR private.is_admin());

-- ─── TABELA 11: public.streamer_wallets ─────────────────────────────────
DROP POLICY IF EXISTS "streamer_wallets_select" ON public.streamer_wallets;
CREATE POLICY "streamer_wallets_select" ON public.streamer_wallets
  FOR SELECT
  TO authenticated
  USING (
    user_id = private.get_current_user_id()
    OR streamer_id = private.get_current_user_id()
    OR private.is_admin()
  );

-- ─── TABELA 12: public.streamer_wallet_transactions ─────────────────────
DROP POLICY IF EXISTS "streamer_wallet_tx_select" ON public.streamer_wallet_transactions;
CREATE POLICY "streamer_wallet_tx_select" ON public.streamer_wallet_transactions
  FOR SELECT
  TO authenticated
  USING (
    user_id = private.get_current_user_id()
    OR streamer_id = private.get_current_user_id()
    OR private.is_admin()
  );

-- ─── TABELA 13: public.streamer_applications ────────────────────────────
DROP POLICY IF EXISTS "applications_select_policy" ON public.streamer_applications;
DROP POLICY IF EXISTS "applications_insert_policy" ON public.streamer_applications;
DROP POLICY IF EXISTS "applications_admin_update" ON public.streamer_applications;

CREATE POLICY "applications_select_policy" ON public.streamer_applications
  FOR SELECT
  TO authenticated
  USING (applicant_id = private.get_current_user_id() OR private.is_admin());

CREATE POLICY "applications_insert_policy" ON public.streamer_applications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    applicant_id = private.get_current_user_id()
    AND status = 'pending'
  );

CREATE POLICY "applications_admin_update" ON public.streamer_applications
  FOR UPDATE
  TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

-- ─── TABELA 14: public.streamer_roulette_spins ──────────────────────────
DROP POLICY IF EXISTS "roulette_spins_select_policy" ON public.streamer_roulette_spins;
CREATE POLICY "roulette_spins_select_policy" ON public.streamer_roulette_spins
  FOR SELECT
  TO authenticated
  USING (
    user_id = private.get_current_user_id()
    OR streamer_id = private.get_current_user_id()
    OR private.is_admin()
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- ETAPA 6: REMOVER FUNÇÕES ANTIGAS DO SCHEMA PUBLIC
-- ═══════════════════════════════════════════════════════════════════════════
-- As dependências (policies, trigger) já foram atualizadas para private.*,
-- então é seguro dropar as funções antigas sem CASCADE.
DROP FUNCTION IF EXISTS public.get_current_user_id();
DROP FUNCTION IF EXISTS public.is_admin();
DROP FUNCTION IF EXISTS public.is_streamer();
DROP FUNCTION IF EXISTS public.protect_user_critical_columns();

-- ═══════════════════════════════════════════════════════════════════════════
-- ETAPA 7: CORRIGIR VIEW COM SECURITY INVOKER
-- ═══════════════════════════════════════════════════════════════════════════
-- A view roda como o CRIADOR (superuser), ignorando RLS. Com security_invoker,
-- ela respeita as policies do USUÁRIO que consulta.
CREATE OR REPLACE VIEW public.streamer_payment_configs_public
WITH (security_invoker = true)
AS
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

-- ═══════════════════════════════════════════════════════════════════════════
-- ETAPA 8: NOTA SOBRE LEAKED PASSWORD PROTECTION
-- ═══════════════════════════════════════════════════════════════════════════
-- NÃO CORRIGÍVEL VIA SQL. Ação manual necessária no Dashboard:
--
--   Supabase Dashboard → Authentication → Attack Protection
--   → Ativar "Leaked Password Protection" (HaveIBeenPwned)
--
-- Isso bloqueia senhas previamente comprometidas em data breaches globais.
-- ═══════════════════════════════════════════════════════════════════════════

COMMIT;
