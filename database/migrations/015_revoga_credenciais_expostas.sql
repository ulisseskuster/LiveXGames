-- ---------------------------------------------------------------------------
-- 015 - Revoga as credenciais das contas de demonstração que vazaram
--
-- CONTEXTO
-- Até o commit ae489fc, o auto-migrador recriava e reescrevia cinco personas a
-- cada reinício do servidor, em qualquer ambiente, com senhas versionadas num
-- repositório público. O código parou de fazer isso, mas as linhas já gravadas
-- continuam no banco de produção — e as senhas continuam no histórico do git.
-- Medido em produção logo após o deploy:
--
--   admin_livex      admin      108.736 moedas   999 vidas
--   nightpilot       streamer   128.164 moedas   999 vidas
--   testsprite_user  viewer       1.900 moedas
--   viewer_alpha     viewer
--   sub_beta         subscriber
--
-- POR QUE REVOGAR EM VEZ DE APAGAR
-- reward_redemptions.streamer_id e streamer_wallets.streamer_id apontam para
-- users(id) com ON DELETE CASCADE. Apagar 'nightpilot' levaria junto TODO
-- resgate feito no canal dele, inclusive entregas físicas pendentes de usuários
-- reais, e o saldo de apoio que qualquer viewer tenha com esse canal. O que
-- vazou foi a senha, não a conta: inutilizar o hash fecha o acesso sem destruir
-- dado de ninguém, e é reversível.
--
-- 'CREDENCIAL_REVOGADA' não é um hash bcrypt válido. bcrypt.compare() devolve
-- false para qualquer entrada contra um hash malformado (verificado), então o
-- login responde 401 normalmente, sem exceção e sem virar 500.
--
-- AMBIENTES
-- Fora de produção a revogação das quatro personas é desfeita logo em seguida,
-- no mesmo arranque: seedDemoPersonas roda depois das migrações e regrava o
-- password_hash delas (ver autoMigrate.js). A suíte E2E continua funcionando.
-- Em produção seedDemoPersonas retorna cedo, então a revogação vale.
-- admin_livex é exceção nos dois ambientes: só volta a ter senha se
-- ADMIN_PASSWORD estiver definida, que é a política desde o commit ae489fc.
--
-- COMO DEVOLVER ACESSO ADMINISTRATIVO
--   a) defina ADMIN_PASSWORD no ambiente e reinicie — syncAdminUser regrava a
--      senha de admin_livex a partir dela; ou
--   b) coloque seu username em ADMIN_USERNAMES (já está como 'ukc___') e faça
--      login com a sua própria conta: ela é promovida a admin no login.
-- ---------------------------------------------------------------------------

UPDATE users
SET password_hash = 'CREDENCIAL_REVOGADA'
WHERE LOWER(username) IN ('viewer_alpha', 'sub_beta', 'nightpilot', 'testsprite_user', 'admin_livex')
  AND password_hash <> 'CREDENCIAL_REVOGADA';
