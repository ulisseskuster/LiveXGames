-- ---------------------------------------------------------------------------
-- 009 - Remove o Chrono Storm da plataforma
--
-- O Chrono Storm estava inteiramente implementado (engine autoritativa,
-- renderizador no cliente, protagonista, 3 itens) mas nunca foi exposto: o
-- catálogo do index.html só tem os três cards originais. Mesmo assim era
-- alcançável — POST /api/game/launch com gameId "chrono_storm" devolvia uma
-- partida válida, que consumia vida, creditava moeda e entrava no ranking — e
-- os três itens dele apareciam em /api/shop/items, à venda para um jogo que
-- ninguém conseguia abrir. A decisão foi retirar, não lançar.
--
-- ATENÇÃO AO REEXECUTAR: este projeto não tem tabela de controle de migrações.
-- O autoMigrate relê e reaplica TODOS os arquivos .sql a cada inicialização do
-- servidor, então toda migração precisa ser idempotente por construção. Um
-- reembolso escrito de forma ingênua (UPDATE wallets SET balance = balance + X)
-- recreditaria o valor a cada restart — exatamente a máquina de moeda infinita
-- que as migrações anteriores fecharam.
--
-- A idempotência aqui vem do encadeamento: o reembolso é calculado a partir das
-- linhas que o DELETE do inventário realmente removeu. Na segunda execução não
-- sobra nenhuma linha de item do Chrono Storm, o CTE volta vazio, e nem a
-- carteira nem o extrato são tocados.
-- ---------------------------------------------------------------------------

-- 1. Devolve as moedas de quem comprou, remove os itens do inventário e deixa o
--    crédito registrado no extrato. Tudo em uma instrução só, para que o valor
--    devolvido venha sempre do que foi de fato apagado.
WITH removidos AS (
  DELETE FROM user_inventory ui
  USING shop_items si
  WHERE ui.item_id = si.id
    AND si.game_id = 'chrono_storm'
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
    'motivo', 'chrono_storm_removido',
    'descricao', 'Reembolso automático dos itens do Chrono Storm, jogo retirado da plataforma'
  )
FROM creditados;

-- 2. Tira os itens da loja. Precisa vir depois do passo 1: user_inventory tem
--    ON DELETE CASCADE para shop_items, então apagar aqui primeiro levaria o
--    inventário junto e ninguém seria reembolsado.
DELETE FROM shop_items WHERE game_id = 'chrono_storm';

-- 3. O histórico de partidas (flight_runs) é preservado de propósito: são voos
--    que aconteceram de verdade, e apagá-los reescreveria o ranking de quem
--    jogou. Ficam como registro do que foi.
