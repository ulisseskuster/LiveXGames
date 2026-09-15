-- ---------------------------------------------------------------------------
-- 011 - O trigger de proteção para de reverter as escritas do próprio backend
--
-- SINTOMA: em produção as vidas diárias nunca eram debitadas. Um usuário recém
-- registrado voava 5 vezes seguidas e continuava com 3/3. Não era o bug de
-- regeneração corrigido antes (esse era real e está consertado): aqui a escrita
-- simplesmente não chegava à tabela.
--
-- CAUSA: o trigger trg_protect_user_columns (migração 001, movido para o schema
-- private na 007) roda BEFORE UPDATE em public.users e faz, para quem não é
-- admin:
--
--     NEW.lives := OLD.lives;
--
-- Ou seja, ele não rejeita o UPDATE — ele o esvazia. A instrução "funciona",
-- afeta 1 linha, o RETURNING devolve uma linha, e o backend segue achando que
-- debitou a vida. Por isso consumeLife nunca retornava null (nunca havia
-- NO_LIVES_REMAINING) e mesmo assim o saldo nunca baixava.
--
-- private.is_admin() se apoia em auth.uid(), que só existe em sessões vindas do
-- PostgREST. O backend conecta direto no Postgres com o seu próprio papel, onde
-- auth.uid() é NULL — então is_admin() é sempre falso e TODA escrita do backend
-- nessas colunas era revertida.
--
-- ALCANCE: não eram só as vidas. O trigger reverte também role, is_sub_twitch,
-- is_sub_kick, email, username e password_hash. Isso significa que promover um
-- streamer aprovado, sincronizar a insígnia de Subscritor da Twitch/Kick e
-- trocar e-mail ou usuário também vinham falhando calados em produção.
--
-- CORREÇÃO: a proteção existe para impedir que um cliente do PostgREST se
-- promova a admin ou se dê vidas — essas sessões chegam como 'anon' ou
-- 'authenticated'. O backend não é uma dessas sessões: ele é a autoridade do
-- jogo e precisa debitar vida, promover streamer e sincronizar assinatura. A
-- guarda passa a valer só para os papéis expostos publicamente, preservando
-- exatamente a intenção de segurança original. As policies RLS continuam
-- valendo por cima, inalteradas.
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.protect_user_critical_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Só as sessões que chegam pela API pública são barradas. Qualquer outro
  -- papel é conexão de serviço confiável (o backend), que precisa escrever.
  IF current_user IN ('anon', 'authenticated') AND NOT private.is_admin() THEN
    NEW.role := OLD.role;
    NEW.lives := OLD.lives;
    NEW.max_lives := OLD.max_lives;
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

-- A versão antiga em public.* ficou órfã depois da 007, mas é recriada aqui com
-- a mesma guarda: se algum banco ainda tiver o trigger apontando para ela, o
-- comportamento tem de ser o mesmo.
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
