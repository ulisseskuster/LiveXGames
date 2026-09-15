-- 024: Sistema de conquistas (achievements)
-- Conquistas automáticas desbloqueadas por eventos de jogo, doação e social.
-- Cada conquista tem um trigger (evento + condição numérica), e o backend checa
-- após cada ação relevante.

BEGIN;

CREATE TABLE IF NOT EXISTS achievements (
  id          VARCHAR(60) PRIMARY KEY,
  title       VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  icon        VARCHAR(10) NOT NULL DEFAULT '🏆',
  category    VARCHAR(30) NOT NULL DEFAULT 'game'
              CHECK (category IN ('game', 'donation', 'social', 'streamer', 'milestone')),
  threshold   INT NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_achievements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id VARCHAR(60) NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_achievement ON user_achievements(achievement_id);

ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;

-- ─── Conquistas iniciais ────────────────────────────────────────────────────

-- Game
INSERT INTO achievements (id, title, description, icon, category, threshold) VALUES
  ('first_flight',      'Primeiro Voo',         'Jogue sua primeira rodada na Arena',                    '🚀', 'game', 1),
  ('flights_10',        'Piloto Veterano',      'Complete 10 rodadas na Arena',                          '✈️', 'game', 10),
  ('flights_50',        'Ás da Arena',           'Complete 50 rodadas na Arena',                          '🎖️', 'game', 50),
  ('flights_100',       'Lenda da Arena',        'Complete 100 rodadas na Arena',                         '👑', 'game', 100),
  ('high_score_1000',   'Mil Pontos',            'Alcance 1000 pontos numa única rodada',                 '⭐', 'game', 1000),
  ('high_score_5000',   'Cinco Mil Pontos',      'Alcance 5000 pontos numa única rodada',                 '🌟', 'game', 5000),
  ('high_score_10000',  'Dez Mil Pontos',        'Alcance 10.000 pontos numa única rodada',               '💫', 'game', 10000),
  ('play_all_games',    'Explorador Universal',  'Jogue pelo menos uma vez nos três jogos',               '🎮', 'game', 3);

-- Donation
INSERT INTO achievements (id, title, description, icon, category, threshold) VALUES
  ('first_donation',    'Primeira Doação',       'Faça sua primeira doação via PIX',                     '💰', 'donation', 1),
  ('donations_5',       'Apoiador',              'Faça 5 doações',                                       '💎', 'donation', 5),
  ('donations_20',      'Patrocinador',          'Faça 20 doações',                                      '🏦', 'donation', 20),
  ('big_donation',      'Generoso',              'Doe mais de R$ 50 numa única transação',               '👑', 'donation', 5000);

-- Social
INSERT INTO achievements (id, title, description, icon, category, threshold) VALUES
  ('first_reaction',    'Reagiu!',               'Deixe sua primeira reação no mural',                   '👍', 'social', 1),
  ('reactions_50',      'Crítico',               'Deixe 50 reações no mural',                            '💬', 'social', 50),
  ('first_redeem',      'Primeiro Resgate',       'Resgate seu primeiro brinde de um streamer',           '🎁', 'social', 1),
  ('redeems_5',         'Colecionador',           'Resgate 5 brindes de streamers',                       '📦', 'social', 5);

-- Streamer
INSERT INTO achievements (id, title, description, icon, category, threshold) VALUES
  ('streamer_welcome',  'Bem-vindo ao Clube',    'Sua candidatura de streamer foi aprovada',             '🎉', 'streamer', 1),
  ('first_reward',      'Primeiro Brinde',       'Crie seu primeiro brinde na loja',                     '🏷️', 'streamer', 1),
  ('donations_received_10', 'Popular',           'Receba 10 doações no seu canal',                       '🔥', 'streamer', 10),
  ('players_100',       'Mestre dos Jogos',      '100 jogadores diferentes jogaram no seu canal',        '🏆', 'streamer', 100)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  category = EXCLUDED.category,
  threshold = EXCLUDED.threshold;

COMMIT;
