-- Migração 004: Garantir índice único para external_id e suportar doações anônimas/unclaimed
DO $$
BEGIN
  -- Permite user_id nulo para doações de usuários externos não cadastrados
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'donations' AND column_name = 'user_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE donations ALTER COLUMN user_id DROP NOT NULL;
  END IF;
END $$;

-- Índice único para idempotência absoluta de webhooks
CREATE UNIQUE INDEX IF NOT EXISTS idx_donations_external_id ON donations(external_id);
