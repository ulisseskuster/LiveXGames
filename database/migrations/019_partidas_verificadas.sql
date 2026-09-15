-- Partidas jogadas no navegador e verificadas por replay no servidor.
--
-- Tabela própria em vez de colunas em flight_runs: uma partida passa por
-- aberta → verificando → verificada/recusada/abandonada/expirada, e flight_runs é
-- lido direto pelo ranking e pelo histórico. Guardar partidas abertas lá faria
-- cada consulta existente precisar de um filtro de status, e a primeira que
-- esquecesse mostraria partidas com score 0 no ranking. flight_runs continua
-- recebendo só o resultado final verificado.

BEGIN;

CREATE TABLE IF NOT EXISTS public.game_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  game_id       VARCHAR(40) NOT NULL,
  -- Semente emitida pelo servidor. Sem ela o replay não reproduz a pista.
  seed          TEXT NOT NULL,
  -- Partida aberta numa versão da simulação só é verificável por essa versão.
  sim_version   INT NOT NULL,
  -- { itemIds: [...reservados], bytes: base64 do loadout codificado na abertura }.
  -- Os bytes ficam gravados porque o catálogo pode mudar entre abrir e terminar.
  loadout       JSONB NOT NULL DEFAULT '{}'::jsonb,
  used_sub_life BOOLEAN NOT NULL DEFAULT FALSE,
  status        VARCHAR(20) NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'verifying', 'verified', 'rejected', 'abandoned', 'expired', 'error')),
  input_log     BYTEA,
  result        JSONB,
  flight_run_id UUID REFERENCES public.flight_runs(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  finished_at   TIMESTAMPTZ
);

-- Uma partida em andamento por usuário, garantida pelo banco: duas aberturas
-- simultâneas não passam as duas pela checagem do serviço.
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_runs_uma_aberta_por_usuario
  ON public.game_runs(user_id) WHERE status IN ('open', 'verifying');

CREATE INDEX IF NOT EXISTS idx_game_runs_user_created
  ON public.game_runs(user_id, created_at DESC);

-- Ranking por jogo. Partidas antigas ficam com NULL.
ALTER TABLE public.flight_runs ADD COLUMN IF NOT EXISTS game_id VARCHAR(40);
CREATE INDEX IF NOT EXISTS idx_flight_runs_game_score
  ON public.flight_runs(game_id, score DESC);

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Mesmo raciocínio da 017: o backend ignora RLS, mas tabela nova sem RLS reabre o
-- alerta do linter do Supabase. Partida vale vida, item e moeda: cliente direto
-- do PostgREST não escreve aqui.
ALTER TABLE public.game_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE INSERT, UPDATE, DELETE ON public.game_runs FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.game_runs FROM anon;
  END IF;
END $$;

COMMIT;
