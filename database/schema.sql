-- Jet Launcher Database Schema
-- Compatível com PostgreSQL 14+

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Usuários e Perfis
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120),
  phone VARCHAR(30),
  username VARCHAR(80) UNIQUE NOT NULL,
  email VARCHAR(160) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'streamer', 'subscriber', 'admin')),
  lives INT NOT NULL DEFAULT 3,
  max_lives INT NOT NULL DEFAULT 3,
  last_life_refill TIMESTAMP NOT NULL DEFAULT NOW(),
  twitch_id VARCHAR(80),
  twitch_username VARCHAR(80),
  kick_id VARCHAR(80),
  kick_username VARCHAR(80),
  is_sub_twitch BOOLEAN NOT NULL DEFAULT FALSE,
  is_sub_kick BOOLEAN NOT NULL DEFAULT FALSE,
  -- URLs de doação personalizadas pelo streamer. NULL = usa o padrão montado a
  -- partir do username. Ver migrations/013_urls_de_doacao_do_streamer.sql.
  livepix_url TEXT,
  pixgg_url TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Carteiras Virtuais
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency_code VARCHAR(10) NOT NULL DEFAULT 'credits',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Itens da Loja (Supply Bay)
CREATE TABLE IF NOT EXISTS shop_items (
  id VARCHAR(80) PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  type VARCHAR(40) NOT NULL CHECK (type IN ('nitro', 'shield', 'fuel', 'cosmetic', 'attack', 'defense', 'utility', 'lives')),
  description TEXT,
  price BIGINT NOT NULL CHECK (price >= 0),
  rarity VARCHAR(30) NOT NULL DEFAULT 'common' CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
  icon VARCHAR(20) DEFAULT '🚀',
  flight_bonus JSONB DEFAULT '{}'::jsonb,
  stock INT NOT NULL DEFAULT 999,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Inventário de Usuários
CREATE TABLE IF NOT EXISTS user_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id VARCHAR(80) NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  quantity INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, item_id)
);

-- Histórico Geral de Transações
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id VARCHAR(80) REFERENCES shop_items(id) ON DELETE SET NULL,
  -- Precisa listar todo tipo que o código grava: o INSERT do extrato acontece na
  -- mesma transação do crédito na carteira, então um tipo fora desta lista faz a
  -- transação inteira sofrer ROLLBACK e a moeda some sem erro visível.
  -- Ver migrations/012_transactions_tipos_faltantes.sql.
  type VARCHAR(30) NOT NULL CHECK (type IN ('donation', 'subscription', 'purchase', 'flight_reward', 'daily_roulette', 'reward_redemption', 'admin_grant', 'refund')),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount BIGINT NOT NULL CHECK (amount >= 0),
  currency_code VARCHAR(10) NOT NULL DEFAULT 'credits',
  status VARCHAR(25) NOT NULL DEFAULT 'completed',
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Doações Financeiras (LivePix / PIX)
CREATE TABLE IF NOT EXISTS donations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL DEFAULT 'livepix',
  external_id VARCHAR(120) UNIQUE NOT NULL,
  amount_cents BIGINT NOT NULL,
  coins_credited BIGINT NOT NULL,
  status VARCHAR(25) NOT NULL DEFAULT 'completed',
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Histórico de Voos Autoritativos do Jato
CREATE TABLE IF NOT EXISTS flight_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  distance NUMERIC(10, 2) NOT NULL,
  max_altitude NUMERIC(10, 2) NOT NULL,
  score BIGINT NOT NULL,
  coins_earned BIGINT NOT NULL DEFAULT 0,
  items_used JSONB DEFAULT '[]'::jsonb,
  flight_script JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Índices de Desempenho
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_user ON user_inventory(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_donations_external_id ON donations(external_id);
CREATE INDEX IF NOT EXISTS idx_flight_runs_weekly ON flight_runs(created_at, score DESC);
CREATE INDEX IF NOT EXISTS idx_flight_runs_user ON flight_runs(user_id, created_at DESC);

-- Lojinha do Streamer (Brindes & Recompensas Reais)
CREATE TABLE IF NOT EXISTS streamer_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  streamer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  price_coins BIGINT NOT NULL CHECK (price_coins > 0),
  stock INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  image_url TEXT NOT NULL,
  delivery_type VARCHAR(20) NOT NULL DEFAULT 'physical' CHECK (delivery_type IN ('physical', 'digital')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'inactive')),
  review_notes TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Resgates de Brindes e Pedidos de Envio
CREATE TABLE IF NOT EXISTS reward_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id UUID NOT NULL REFERENCES streamer_rewards(id) ON DELETE CASCADE,
  streamer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coins_spent BIGINT NOT NULL CHECK (coins_spent > 0),
  delivery_type VARCHAR(20) NOT NULL,
  recipient_name VARCHAR(100),
  shipping_address TEXT,
  digital_code TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'pending_fulfillment' CHECK (status IN ('pending_fulfillment', 'shipped', 'completed', 'cancelled')),
  tracking_code VARCHAR(80),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_streamer_rewards_streamer ON streamer_rewards(streamer_id);
CREATE INDEX IF NOT EXISTS idx_streamer_rewards_status ON streamer_rewards(status);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_streamer ON reward_redemptions(streamer_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_user ON reward_redemptions(user_id);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Segredos de webhook exclusivos por streamer (LivePix/PixGG) — cada streamer conecta
-- sua própria conta de doações, então não é mais um único segredo global.
CREATE TABLE IF NOT EXISTS streamer_payment_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  streamer_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  livepix_webhook_secret VARCHAR(255),
  pixgg_webhook_secret VARCHAR(255),
  pixgg_client_id VARCHAR(255),
  pixgg_client_secret VARCHAR(255),
  livepix_client_id VARCHAR(255),
  livepix_client_secret VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE streamer_payment_configs ADD COLUMN IF NOT EXISTS pixgg_client_id VARCHAR(255);
ALTER TABLE streamer_payment_configs ADD COLUMN IF NOT EXISTS pixgg_client_secret VARCHAR(255);
ALTER TABLE streamer_payment_configs ADD COLUMN IF NOT EXISTS livepix_client_id VARCHAR(255);
ALTER TABLE streamer_payment_configs ADD COLUMN IF NOT EXISTS livepix_client_secret VARCHAR(255);

-- Fichas de Apoio: saldo separado por par (usuário, streamer). Substitui a antiga
-- carteira global (`wallets`/`credits`), que fica congelada só para histórico.
CREATE TABLE IF NOT EXISTS streamer_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  streamer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency_code VARCHAR(20) NOT NULL DEFAULT 'fichas_apoio',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, streamer_id)
);
CREATE INDEX IF NOT EXISTS idx_streamer_wallets_user ON streamer_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_streamer_wallets_streamer ON streamer_wallets(streamer_id);

CREATE TABLE IF NOT EXISTS streamer_wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  streamer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id UUID,
  type VARCHAR(30) NOT NULL CHECK (type IN ('donation', 'purchase', 'reward_redemption', 'daily_roulette', 'refund', 'admin_grant')),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount BIGINT NOT NULL CHECK (amount >= 0),
  status VARCHAR(25) NOT NULL DEFAULT 'completed',
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_streamer_wallet_tx_user_streamer ON streamer_wallet_transactions(user_id, streamer_id);

-- Doações antigas ficam com streamer_id nulo (histórico da era da carteira global);
-- a partir de agora toda doação nova tem um streamer_id (cada streamer usa seu
-- próprio webhook).
ALTER TABLE donations ADD COLUMN IF NOT EXISTS streamer_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_donations_streamer ON donations(streamer_id);

-- Fila de candidatura para um usuário comum virar streamer verificado.
CREATE TABLE IF NOT EXISTS streamer_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_platform VARCHAR(30) NOT NULL CHECK (channel_platform IN ('twitch', 'kick', 'youtube', 'other')),
  channel_url TEXT NOT NULL,
  pitch TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_notes TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_streamer_applications_applicant ON streamer_applications(applicant_id);
CREATE INDEX IF NOT EXISTS idx_streamer_applications_status ON streamer_applications(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_streamer_applications_one_pending
  ON streamer_applications(applicant_id) WHERE status = 'pending';

-- Roleta diária por streamer: no máximo 1 giro por (usuário, streamer, dia).
CREATE TABLE IF NOT EXISTS streamer_roulette_spins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  streamer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spin_date DATE NOT NULL DEFAULT CURRENT_DATE,
  prize_type VARCHAR(30) NOT NULL CHECK (prize_type IN ('fichas', 'extra_life', 'item')),
  prize_amount INT NOT NULL DEFAULT 0,
  item_id VARCHAR(80),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, streamer_id, spin_date)
);
CREATE INDEX IF NOT EXISTS idx_roulette_spins_user_streamer ON streamer_roulette_spins(user_id, streamer_id);

-- ---------------------------------------------------------------------------
-- Ajustes idempotentes para bancos criados antes destas colunas/constraints.
-- Ficam aqui (e não em database/migrations) porque o schema.sql roda ANTES das
-- migrations: a 002_rebalance_economy.sql insere um item do tipo 'lives' e
-- precisa que o CHECK já aceite esse valor, senão o INSERT inteiro é rejeitado.
-- ---------------------------------------------------------------------------

-- 'lives' é o tipo do item life_pack (Bateria de Vidas), ausente do CHECK original.
ALTER TABLE shop_items DROP CONSTRAINT IF EXISTS shop_items_type_check;
ALTER TABLE shop_items ADD CONSTRAINT shop_items_type_check
  CHECK (type IN ('nitro', 'shield', 'fuel', 'cosmetic', 'attack', 'defense', 'utility', 'lives'));

-- Jogo ao qual o item pertence ('all' = disponível em todos). A coluna nunca
-- existiu no schema, então o catálogo vindo do PostgreSQL devolvia gameId nulo
-- e o frontend perdia o filtro de itens por jogo.
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS game_id VARCHAR(40) NOT NULL DEFAULT 'all';

