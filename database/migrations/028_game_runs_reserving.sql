-- Fase 2 (P0-B): abertura de rodada com intenção persistente.
--
-- O fluxo antigo consumia vida + reservava itens e SÓ DEPOIS gravava a rodada:
-- uma queda entre o débito e o INSERT perdia vida/item sem nenhuma rodada
-- registrada (auditoria ESCALA.md, P0-B).
--
-- Esta migração adiciona o estado 'reserving' ao ciclo de vida: a roda é
-- registrada (intenção) ANTES de consumir recursos, e a geração da simulação
-- acontece fora da transação longa. Transições:
--   reserving -> open        (geração concluída, pronto para jogar)
--   reserving -> abandoned   (falha/compensação recuperável devolve recursos)
--
-- O índice único "uma aberta por usuário" passa a cobrir também 'reserving',
-- impedindo duas aberturas simultâneas do mesmo usuário.

-- 1. Amplia o CHECK de status para aceitar 'reserving'.
ALTER TABLE public.game_runs DROP CONSTRAINT IF EXISTS game_runs_status_check;
ALTER TABLE public.game_runs ADD CONSTRAINT game_runs_status_check
  CHECK (status IN ('open', 'verifying', 'verified', 'rejected', 'abandoned', 'expired', 'error', 'reserving'));

-- 2. Índice único cobre 'reserving' também: uma intenção por usuário.
DROP INDEX IF EXISTS idx_game_runs_uma_aberta_por_usuario;
CREATE UNIQUE INDEX idx_game_runs_uma_aberta_por_usuario
  ON public.game_runs(user_id) WHERE status IN ('open', 'verifying', 'reserving');

-- 3. Índice para recuperação de intenções órfãs (processo caiu no meio).
CREATE INDEX IF NOT EXISTS idx_game_runs_reserving_stale
  ON public.game_runs(created_at) WHERE status = 'reserving';

-- 4. Chave de idempotência: permite repetir com segurança o MESMO pedido de
--    abertura (mesmo clique reenviado) sem abrir duas rodadas.
ALTER TABLE public.game_runs ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_runs_idempotency_key
  ON public.game_runs(idempotency_key) WHERE idempotency_key IS NOT NULL;