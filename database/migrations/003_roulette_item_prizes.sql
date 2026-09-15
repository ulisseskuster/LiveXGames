-- 003_roulette_item_prizes.sql: Suporte a itens de inventário na roleta diária

ALTER TABLE streamer_roulette_spins ADD COLUMN IF NOT EXISTS item_id VARCHAR(80);

-- Atualiza a constraint de tipo de prêmio para permitir 'item'
DO $$
BEGIN
  ALTER TABLE streamer_roulette_spins DROP CONSTRAINT IF EXISTS streamer_roulette_spins_prize_type_check;
  ALTER TABLE streamer_roulette_spins ADD CONSTRAINT streamer_roulette_spins_prize_type_check 
    CHECK (prize_type IN ('fichas', 'extra_life', 'item'));
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;
