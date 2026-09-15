-- Nova contabilidade: os saldos globais e os antigos espelhos de apoio permanecem
-- intactos para conciliação. Não é seguro copiar saldos cujo débito era global.
CREATE TABLE IF NOT EXISTS channel_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  streamer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  extra_lives INTEGER NOT NULL DEFAULT 0 CHECK (extra_lives >= 0),
  currency_code VARCHAR(20) NOT NULL DEFAULT 'credits',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, streamer_id)
);
CREATE TABLE IF NOT EXISTS channel_wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  streamer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT,
  type VARCHAR(30) NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount BIGINT NOT NULL CHECK (amount >= 0),
  status VARCHAR(25) NOT NULL DEFAULT 'completed',
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_channel_transactions_user_channel
  ON channel_wallet_transactions(user_id, streamer_id, created_at);
CREATE TABLE IF NOT EXISTS channel_inventory (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  streamer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id VARCHAR(80) NOT NULL REFERENCES shop_items(id),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY(user_id, streamer_id, item_id)
);
ALTER TABLE game_runs ADD COLUMN IF NOT EXISTS streamer_id UUID REFERENCES users(id);
ALTER TABLE game_runs ADD COLUMN IF NOT EXISTS used_channel_life BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE flight_runs ADD COLUMN IF NOT EXISTS streamer_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_flights_channel_game ON flight_runs(streamer_id, game_id);
ALTER TABLE channel_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_inventory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON channel_wallets, channel_wallet_transactions, channel_inventory FROM PUBLIC;
