-- 002_rebalance_economy.sql: Atualização dos preços da loja de suprimentos para economia sustentável

UPDATE shop_items SET price = 35, description = 'Injeção dupla de pós-combustão. Acelera o jato no lançamento em +350km/h e adiciona +450m de impulso.' WHERE id = 'nitro_booster';
UPDATE shop_items SET price = 45, description = 'Campo de força cinético que absorve o primeiro obstáculo no trajeto sem sofrer dano ou perda de altitude.' WHERE id = 'shield_deflector';
UPDATE shop_items SET price = 60, description = 'Tanque de combustível aerodinâmico descartável. Aumenta o tempo total de queima de voo em +40%.' WHERE id = 'extra_fuel';
UPDATE shop_items SET price = 800, description = 'Estilo dourado especial de decolagem e multiplicador de x1.5 em moedas e pontuação ganhos na corrida. (Permanente)', flight_bonus = '{"scoreMultiplier": 1.5, "coinsMultiplier": 1.5, "goldenTrail": true, "isPermanent": true}'::jsonb WHERE id = 'vip_hangar';

-- Inserir novos itens se não existirem
INSERT INTO shop_items (id, name, type, description, price, rarity, icon, flight_bonus, stock, is_active)
VALUES
  ('nos_injection', 'Injeção de NOS', 'nitro', 'Garrafa dupla de óxido nitroso. Aceleração instantânea de 0 a 300km/h na autoestrada.', 35, 'rare', '⚡', '{"boostSpeed": 1.6, "initialDistanceBonus": 400}'::jsonb, 999, true),
  ('drift_tires', 'Pneus Radiais de Drift', 'utility', 'Composto macio de alta aderência. Multiplica o controle em curvas e derrapagens.', 30, 'common', '🛞', '{"driftControl": 1.4}'::jsonb, 999, true),
  ('emp_shield', 'Escudo de Pulso EMP', 'shield', 'Emite pulso eletromagnético que neutraliza o primeiro bloqueio policial ou radar de velocidade.', 45, 'rare', '🌐', '{"absorbHits": 1}'::jsonb, 999, true),
  ('neon_garage', 'Garagem Synthwave VIP', 'cosmetic', 'Underglow neon arco-íris pulsante e multiplicador de x1.5 em pontuação de corrida. (Permanente)', 800, 'legendary', '🏎️', '{"scoreMultiplier": 1.5, "coinsMultiplier": 1.5, "isPermanent": true}'::jsonb, 999, true),
  ('quantum_jump', 'Salto Quântico', 'nitro', 'Acelera a dobra espacial, transportando a nave por +500 anos-luz instantaneamente.', 40, 'epic', '🌀', '{"boostSpeed": 1.7, "initialDistanceBonus": 500}'::jsonb, 999, true),
  ('plasma_shield', 'Escudo de Plasma Cósmico', 'shield', 'Barreira magnética de plasma que vaporiza o primeiro asteroide no campo espacial.', 45, 'rare', '🔮', '{"absorbHits": 1}'::jsonb, 999, true),
  ('dark_matter', 'Matéria Escura Propulsora', 'fuel', 'Combustível exótico de antimatéria. Prolonga a propulsão estelar em +40%.', 60, 'epic', '🪐', '{"extraFuelPercent": 40}'::jsonb, 999, true),
  ('cosmo_skin', 'Casco de Ouro Interestelar', 'cosmetic', 'Revestimento dourado anti-radiação e multiplicador de x1.5 de score cósmico. (Permanente)', 800, 'legendary', '✨', '{"scoreMultiplier": 1.5, "coinsMultiplier": 1.5, "isPermanent": true}'::jsonb, 999, true),
  ('life_pack', 'Bateria de Vidas (+2 Vidas)', 'lives', 'Recarrega instantaneamente +2 vidas diárias para você continuar jogando na live.', 50, 'common', '❤️', '{"extraLives": 2}'::jsonb, 999, true)
ON CONFLICT (id) DO UPDATE SET
  price = EXCLUDED.price,
  description = EXCLUDED.description,
  name = EXCLUDED.name,
  icon = EXCLUDED.icon,
  flight_bonus = EXCLUDED.flight_bonus;
