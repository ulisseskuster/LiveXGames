-- Fase 1 (P0-A): doação atômica e recuperável.
--
-- O fluxo antigo gravava donations.status='completed' ANTES de creditar a
-- carteira; uma queda ou falha no crédito deixava a doação 'completed' sem
-- saldo, e a reentrega do webhook era engolida pela idempotência.
--
-- Esta migração:
--   1. Garante a coluna status e adiciona o rastro credited_at (a coluna
--      precisa existir ANTES do índice que a referencia).
--   2. Cria o índice de reconciliação: doações 'pending' (crédito ainda não
--      aplicado) e 'completed' cujo crédito não tem comprovante na carteira.
ALTER TABLE public.donations ADD COLUMN IF NOT EXISTS credited_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_donations_reconcile
  ON donations(status, credited_at)
  WHERE status IN ('pending', 'completed');