-- ---------------------------------------------------------------------------
-- 008 - Reprecifica a loja para a economia baseada em distância
--
-- Contexto: services/economy.js passou a pagar moeda estritamente por distância
-- percorrida (~45 moedas numa partida mediana, em qualquer um dos 4 jogos). Os
-- preços antigos foram calibrados quando a moeda era um valor fixo por jogo
-- (280/270/290/350, sempre no teto), então nenhum deles fazia mais sentido.
--
-- O princípio agora: NENHUM item pode se pagar em moeda. Distância compra
-- dinheiro; item compra ranking. Se um item rendesse mais moeda do que custa,
-- comprá-lo viraria compra obrigatória e, pior, uma máquina de moeda.
--
-- Medido com 400 partidas por configuração:
--
--   NITRO (50)      dobra a distância: +36 a +46 moedas, ~2x no score.
--                   Custava 35-45 e dava LUCRO de +6 a +8 por partida, ou seja
--                   era estritamente dominante. A 50 o saldo fica entre -4 e
--                   -14: "um Nitro custa uma partida" e o ganho real é ranking.
--
--   ESCUDO (20/25)  +6 a +8% de distância (+3 moedas), +7% de score. Custava 45
--                   a 50 para devolver 3 moedas — ninguém compraria. O ion_barrier
--                   fica em 25 porque absorve 2 impactos, não 1.
--
--   COMBUSTÍVEL /   nao mexem na distancia: +25 a +31% so no score. Sao itens de
--   UTILITÁRIO (25) ranking puro, e a 60 era caro demais para algo consumido a
--                   cada partida. A 25 custam ~metade da renda de uma partida.
--
--   COSMÉTICO       permanentes, +50% de score. 800/950 ≈ 18-21 partidas por um
--   (inalterado)    bônus vitalício de ranking: continua bem calibrado.
--
--   BATERIA DE      custava 50 e devolvia 2 vidas = 2 partidas ≈ 90 moedas, um
--   VIDAS (150)     lucro de +40 repetível sem limite. Era uma segunda máquina de
--                   moeda infinita, independente do bug de regeneração de vidas.
--                   A 150 recarregar vida compra TEMPO de jogo, nunca moeda.
--
-- Se MOEDAS_POR_PARTIDA_MEDIANA mudar em economy.js, esta tabela tem de ser
-- recalibrada junto: a regra é preço >= ganho de moeda do item.
-- ---------------------------------------------------------------------------

UPDATE shop_items SET price = 50
  WHERE id IN ('nitro_booster', 'nos_injection', 'quantum_jump', 'warp_battery');

UPDATE shop_items SET price = 20
  WHERE id IN ('shield_deflector', 'emp_shield', 'plasma_shield');

UPDATE shop_items SET price = 25 WHERE id = 'ion_barrier';

UPDATE shop_items SET price = 25
  WHERE id IN ('extra_fuel', 'drift_tires', 'dark_matter');

UPDATE shop_items SET price = 150 WHERE id = 'life_pack';
