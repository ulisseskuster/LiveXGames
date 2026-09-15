-- ---------------------------------------------------------------------------
-- 010 - Remove os dois itens que eram vendidos sem fazer nada
--
-- 'air_strike' (Ataque Aéreo, 40 moedas, type 'attack'): nenhuma engine consulta
-- o tipo 'attack', então o item nunca teve efeito nenhum em partida alguma. Pior:
-- ele não tem definição em lugar nenhum do repositório — só sobrevive no banco de
-- produção, vindo de um seed antigo, e a migração 002 apenas atualiza o preço de
-- uma linha que ela própria não cria. Era dinheiro do jogador em troca de nada.
--
-- 'repair_bot' (Drone Reparador, 30 moedas, type 'utility'): declara
-- `altitudeRecovery: 150`, um efeito que nenhuma engine implementa. Como ficava
-- em game_id 'all', ele também atravessava o filtro de jogo e era identificado
-- pelo Neon Drifter como Pneus de Drift (que são 'utility'), dando +25% de score
-- num jogo para o qual não foi feito. A brecha do 'all' foi fechada no
-- GameService; o item em si continuava sem efeito próprio.
--
-- Os dois saem e quem comprou é reembolsado. Ficam só itens que fazem algo.
--
-- IDEMPOTÊNCIA (este projeto não tem tabela de controle de migrações; o
-- autoMigrate reaplica todos os .sql a cada inicialização): o valor devolvido é
-- calculado a partir das linhas que o DELETE do inventário realmente removeu.
-- Na segunda execução não sobra nada para apagar, o CTE volta vazio e nem a
-- carteira nem o extrato são tocados. Ver migrations/009 para o mesmo padrão.
-- ---------------------------------------------------------------------------

WITH removidos AS (
  DELETE FROM user_inventory ui
  USING shop_items si
  WHERE ui.item_id = si.id
    AND si.id IN ('air_strike', 'repair_bot')
  RETURNING ui.user_id, ui.quantity, si.price
),
totais AS (
  SELECT user_id, SUM(quantity * price)::BIGINT AS total
  FROM removidos
  GROUP BY user_id
),
creditados AS (
  UPDATE wallets w
  SET balance = w.balance + t.total,
      updated_at = NOW()
  FROM totais t
  WHERE w.user_id = t.user_id
  RETURNING w.user_id, t.total
)
INSERT INTO transactions (user_id, type, direction, amount, currency_code, status, metadata)
SELECT
  user_id,
  'refund',
  'credit',
  total,
  'credits',
  'completed',
  jsonb_build_object(
    'motivo', 'itens_inertes_removidos',
    'descricao', 'Reembolso automático de itens retirados da loja por não terem efeito em jogo'
  )
FROM creditados;

-- Depois do reembolso: user_inventory tem ON DELETE CASCADE para shop_items,
-- então apagar aqui primeiro levaria o inventário junto e ninguém receberia nada.
DELETE FROM shop_items WHERE id IN ('air_strike', 'repair_bot');
