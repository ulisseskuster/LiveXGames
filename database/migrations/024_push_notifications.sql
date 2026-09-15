-- 024_push_notifications.sql
-- Notificações push PWA: inscrições de Web Push por usuário e fila de notificações.
--
-- Regras de negócio:
-- - Um usuário pode ter N inscrições (um por navegador/dispositivo).
-- - A fila guarda o que será entregue; o worker/web-push marca como enviada.
-- - `related_type`/`related_id` polimórficos (reward, redemption, donation) para
--   deep-linking no front.
-- - Nunca apagar notificação enviada: vira histórico do usuário (como doação).

BEGIN;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  keys_auth TEXT NOT NULL,
  keys_p256dh TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  icon VARCHAR(500),
  url VARCHAR(500),
  related_type VARCHAR(40),
  related_id VARCHAR(120),
  delivered_at TIMESTAMP,
  read_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Sem papéis Supabase, nada de policies (ver 017).

COMMIT;