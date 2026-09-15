-- Benefício de sub: sai "10 vidas normais", entra "+2 vidas douradas por dia".
--
-- As douradas não ficam guardadas como saldo: guarda-se quantas foram usadas e
-- em que dia (de Brasília, AAAA-MM-DD). Virar o dia invalida o uso antigo, então
-- elas voltam à meia-noite sem job agendado. Ver UserModel.getSubLives.
ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_lives_used INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_lives_day TEXT;

-- Subs antigos tinham 10 de máximo. Voltam às 3 normais de todo mundo.
UPDATE users SET max_lives = 3, lives = LEAST(lives, 3) WHERE role = 'subscriber';

-- As colunas novas valem vida tanto quanto `lives`: sem entrar na guarda da 011,
-- um cliente do PostgREST zeraria o próprio uso e teria douradas infinitas.
-- Mesma função da 011, com as duas colunas a mais.
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.protect_user_critical_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND NOT private.is_admin() THEN
    NEW.role := OLD.role;
    NEW.lives := OLD.lives;
    NEW.max_lives := OLD.max_lives;
    NEW.sub_lives_used := OLD.sub_lives_used;
    NEW.sub_lives_day := OLD.sub_lives_day;
    NEW.is_sub_twitch := OLD.is_sub_twitch;
    NEW.is_sub_kick := OLD.is_sub_kick;
    NEW.auth_user_id := OLD.auth_user_id;
    NEW.password_hash := OLD.password_hash;
    NEW.email := OLD.email;
    NEW.username := OLD.username;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'protect_user_critical_columns'
  ) THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.protect_user_critical_columns()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $body$
      BEGIN
        IF current_user IN ('anon', 'authenticated') AND NOT public.is_admin() THEN
          NEW.role := OLD.role;
          NEW.lives := OLD.lives;
          NEW.max_lives := OLD.max_lives;
          NEW.sub_lives_used := OLD.sub_lives_used;
          NEW.sub_lives_day := OLD.sub_lives_day;
          NEW.is_sub_twitch := OLD.is_sub_twitch;
          NEW.is_sub_kick := OLD.is_sub_kick;
          NEW.auth_user_id := OLD.auth_user_id;
          NEW.password_hash := OLD.password_hash;
          NEW.email := OLD.email;
          NEW.username := OLD.username;
        END IF;
        RETURN NEW;
      END;
      $body$;
    $fn$;
  END IF;
END;
$$;
