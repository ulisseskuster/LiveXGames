-- Reset único de moedas e pontuações, decidido junto da economia por canal
-- (13/09/2026). Os saldos antigos eram globais e não havia como atribuí-los a um
-- canal, então todos recomeçam do zero.
--
-- Zera: saldo das três carteiras, os três extratos, ranking/histórico
-- (flight_runs) e partidas encerradas (game_runs).
-- Mantém: doações (a idempotência dos webhooks depende delas), pedidos de brinde,
-- itens, vidas extras e giros da roleta. Partidas abertas ficam porque seguram
-- itens reservados e terminam normalmente.
BEGIN;
UPDATE wallets SET balance = 0, updated_at = NOW() WHERE balance <> 0;
UPDATE streamer_wallets SET balance = 0, updated_at = NOW() WHERE balance <> 0;
UPDATE channel_wallets SET balance = 0, updated_at = NOW() WHERE balance <> 0;
DELETE FROM transactions;
DELETE FROM streamer_wallet_transactions;
DELETE FROM channel_wallet_transactions;
DELETE FROM game_runs WHERE status NOT IN ('open', 'verifying');
DELETE FROM flight_runs;
COMMIT;
