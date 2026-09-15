-- ---------------------------------------------------------------------------
-- 012 - transactions.type aceita os tipos que o código realmente grava
--
-- SINTOMA: o prêmio em moedas da roleta diária sumia. A tela anunciava "40
-- Moedas adicionadas à sua carteira", o extrato do canal registrava as 40, e o
-- saldo do jogador não mudava — nem depois de recarregar. Um voo, no mesmo
-- servidor e no mesmo instante, creditava normalmente.
--
-- CAUSA: o CHECK de transactions.type só permitia
--     'donation', 'subscription', 'purchase', 'flight_reward', 'refund'
-- enquanto o código grava também 'daily_roulette', 'reward_redemption' e
-- 'admin_grant'. WalletModel.addCredits credita a carteira e registra o extrato
-- na MESMA transação: o INSERT em transactions viola o CHECK, a transação
-- inteira faz ROLLBACK e o crédito na carteira vai junto. Pior, o erro cai no
-- catch que existe para o fallback em memória, então nada disso aparecia como
-- falha — a função devolvia um saldo novo que nunca chegou ao banco.
--
-- Era por isso que o voo funcionava e a roleta não: 'flight_reward' está na
-- lista, 'daily_roulette' não estava. E era a explicação final para o prêmio
-- aparecer no extrato por streamer e não na carteira: o CHECK de
-- streamer_wallet_transactions já aceitava os três tipos novos.
--
-- ALCANCE: além da roleta, isto derrubava silenciosamente o débito de resgate de
-- brinde ('reward_redemption') e a concessão manual de moedas pelo admin
-- ('admin_grant') na carteira única.
--
-- Os testes locais não pegariam: rodam no fallback em memória, que não tem CHECK
-- nenhum.
--
-- Idempotente: DROP IF EXISTS seguido de ADD, como as demais restrições ajustadas
-- em schema.sql.
-- ---------------------------------------------------------------------------

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;

ALTER TABLE public.transactions ADD CONSTRAINT transactions_type_check
  CHECK (type IN (
    'donation',
    'subscription',
    'purchase',
    'flight_reward',
    'daily_roulette',
    'reward_redemption',
    'admin_grant',
    'refund'
  ));
