-- ---------------------------------------------------------------------------
-- 006 - Associa cada item da loja ao seu jogo
--
-- A coluna game_id é criada pelo schema.sql (idempotente). Esta migração apenas
-- preenche o valor de cada item conhecido, espelhando o catálogo de referência
-- em backend/src/data/store.js. Sem isso, todos os itens ficam em 'all' e o
-- frontend exibe equipamentos de todos os jogos em qualquer um deles.
--
-- Roda depois da 002, que é a migração que insere os itens do Neon Drifter e do
-- Void Walker.
-- ---------------------------------------------------------------------------

UPDATE shop_items SET game_id = 'jet_launcher'
  WHERE id IN ('nitro_booster', 'shield_deflector', 'extra_fuel', 'vip_hangar');

UPDATE shop_items SET game_id = 'neon_drifter'
  WHERE id IN ('nos_injection', 'drift_tires', 'emp_shield', 'neon_garage');

UPDATE shop_items SET game_id = 'void_walker'
  WHERE id IN ('quantum_jump', 'plasma_shield', 'dark_matter', 'cosmo_skin');

-- life_pack (vidas) vale para qualquer jogo; itens legados sem jogo definido
-- permanecem em 'all', que é o default da coluna.
UPDATE shop_items SET game_id = 'all' WHERE id = 'life_pack';
