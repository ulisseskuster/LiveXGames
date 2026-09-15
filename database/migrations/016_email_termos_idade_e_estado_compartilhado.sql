-- ---------------------------------------------------------------------------
-- 016 - Base para recuperação de senha, aceite de termos/idade e estado
--       compartilhado entre instâncias
--
-- Cobre três lacunas que impediam operar a plataforma comercialmente:
--
--   1. Não havia "esqueci minha senha". Quem perdia a senha perdia a conta,
--      porque o sistema não enviava e-mail nenhum.
--   2. Os Termos de Uso existiam só como link no rodapé: não havia aceite no
--      cadastro nem registro de quem aceitou, quando, e de qual versão. E não
--      havia verificação de idade, numa plataforma que converte doação em moeda
--      e entrega brinde físico.
--   3. O limite de tentativas de login e o estado do OAuth viviam na memória do
--      processo. Com mais de uma instância, o limitador contava separado em cada
--      uma (dobrando as tentativas que um atacante consegue) e o retorno do
--      login social caía numa instância que não conhecia o state, fazendo o
--      login falhar de forma aleatória.
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------------ 1. users
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- As contas que já existiam não têm como voltar no tempo para aceitar termos.
-- Ficam com o aceite nulo de propósito: é um dado que não temos, e preencher
-- seria inventar prova de consentimento. A interface pede o aceite no próximo
-- login de quem estiver sem ele.
COMMENT ON COLUMN users.terms_accepted_at IS
  'Quando o usuário aceitou os termos. NULL = conta anterior ao aceite obrigatório.';
COMMENT ON COLUMN users.birth_date IS
  'Data de nascimento declarada no cadastro, usada para a exigência de 18 anos.';

-- --------------------------------------------- 2. tokens de redefinição de senha
--
-- Guarda apenas o HASH do token, nunca o valor enviado por e-mail: quem obtiver
-- uma cópia do banco não consegue redefinir a senha de ninguém. Mesmo princípio
-- de password_hash.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash VARCHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_expira ON password_reset_tokens(expires_at);

-- ------------------------------------------ 3. tokens de verificação de e-mail
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token_hash VARCHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(160) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_verif_user ON email_verification_tokens(user_id);

-- ------------------------------------- 4. estado compartilhado entre instâncias
--
-- Contagem de requisições por chave (IP + rota). Substitui o Map em memória do
-- rateLimiter: com o contador no banco, duas instâncias somam na mesma linha em
-- vez de contar metade cada uma.
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  bucket_key VARCHAR(200) PRIMARY KEY,
  hits INT NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_janela ON rate_limit_counters(window_started_at);

-- State opaco do OAuth (Twitch/Kick), de uso único e com validade. Substitui o
-- Map em memória do oauthStateStore: o retorno do provedor pode cair em
-- qualquer instância, e todas enxergam o mesmo state.
--
-- `extra` guarda o code_verifier do PKCE da Kick, que precisa sobreviver ao
-- round-trip até o provedor e voltar.
CREATE TABLE IF NOT EXISTS oauth_states (
  state VARCHAR(120) PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  extra JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expira ON oauth_states(expires_at);
