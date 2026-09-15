-- Mural Social de Doações: reações 👍/👎 por doação, com ranking semanal/mensal.
--
-- Uma tabela nova só. A contagem sai de COUNT(*) FILTER no JOIN, não de coluna
-- cache: feed limitado a 50 linhas sobre FK indexada resolve em milissegundos, e
-- contador denormalizado dessincroniza no primeiro toggle concorrente.

BEGIN;

-- ─── Reações ────────────────────────────────────────────────────────────────
-- O UNIQUE é a regra de negócio inteira: um usuário, uma reação por doação.
-- Trocar 👍 por 👎 é UPDATE da mesma linha, nunca um segundo registro.
CREATE TABLE IF NOT EXISTS public.donation_reactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id   UUID NOT NULL REFERENCES public.donations(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reaction_type VARCHAR(10) NOT NULL CHECK (reaction_type IN ('like', 'dislike')),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (donation_id, user_id)
);

-- Contagem por doação (o JOIN do feed)
CREATE INDEX IF NOT EXISTS idx_donation_reactions_donation
  ON public.donation_reactions(donation_id);

-- "Este usuário já reagiu?" e limpeza por usuário
CREATE INDEX IF NOT EXISTS idx_donation_reactions_user
  ON public.donation_reactions(user_id);

-- Ranking: filtra por canal + janela de tempo
CREATE INDEX IF NOT EXISTS idx_donations_streamer_created
  ON public.donations(streamer_id, created_at DESC);

-- ─── Moderação ──────────────────────────────────────────────────────────────
-- Coluna, não DELETE: doação é registro financeiro e não some do banco porque
-- a mensagem era imprópria. O mural deixa de mostrar, a contabilidade fica.
ALTER TABLE public.donations
  ADD COLUMN IF NOT EXISTS hidden_from_wall BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── Kill-switch por canal ──────────────────────────────────────────────────
-- Se o mural azedar o clima do canal, o streamer desliga sem esperar deploy.
ALTER TABLE public.streamer_payment_configs
  ADD COLUMN IF NOT EXISTS wall_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- O backend conecta com role dono e ignora RLS, mas a 001 habilitou RLS em tudo
-- e a 007 existe só para calar o linter de segurança do Supabase: tabela nova
-- sem política reabre o alerta.
--
-- O mural é servido só pela API (Pool com DATABASE_URL). A policy
-- donations_select_related continua restringindo donations ao próprio usuário
-- ou ao próprio canal — decisão registrada: não afrouxar. Se um dia o front
-- falar direto com o Supabase, é essa policy que precisa de um OR, não esta.
ALTER TABLE public.donation_reactions ENABLE ROW LEVEL SECURITY;

-- Os papéis 'anon' e 'authenticated' são do Supabase e não existem num
-- PostgreSQL comum (local, Docker, CI). Sem esta guarda, o CREATE POLICY ... TO
-- authenticated estoura 'role does not exist', e como tudo aqui está numa
-- transação só, o ROLLBACK levaria junto a TABELA e a coluna hidden_from_wall —
-- o mural ficaria quebrado em vez de apenas sem RLS. Em banco sem esses papéis
-- não há cliente direto, então não há o que restringir.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    DROP POLICY IF EXISTS "donation_reactions_select_all" ON public.donation_reactions;
    -- Reações são públicas por natureza: é um mural.
    CREATE POLICY "donation_reactions_select_all" ON public.donation_reactions
      FOR SELECT TO authenticated USING (true);
    -- Escrita só pelo backend.
    REVOKE INSERT, UPDATE, DELETE ON public.donation_reactions FROM authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE INSERT, UPDATE, DELETE ON public.donation_reactions FROM anon;
  END IF;
END $$;

COMMIT;
