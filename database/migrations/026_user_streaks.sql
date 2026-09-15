-- 026_user_streaks.sql
-- Streak diário: dias consecutivos com pelo menos uma rodada jogada.
--
-- Regras:
-- - Uma linha por usuário (PK user_id).
-- - current_streak incrementa quando a atividade é hoje ou ontem; se o último
--   dia de atividade for anterior a ontem, a sequência zera e recomeça em 1.
-- - best_streak nunca diminui (record pessoal).
-- - last_activity_date guarda o dia (DATE) da última atividade, não timestamp.

BEGIN;

CREATE TABLE IF NOT EXISTS user_streaks (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_streak INT NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  best_streak INT NOT NULL DEFAULT 0 CHECK (best_streak >= 0),
  last_activity_date DATE,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE user_streaks ENABLE ROW LEVEL SECURITY;

COMMIT;