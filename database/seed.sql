-- Seed base da plataforma — aplicado em todos os ambientes, inclusive produção.
--
-- Só o catálogo da loja de equipamentos, que é conteúdo real do produto.
-- As contas de demonstração saíram daqui para seed.demo.sql (não-produção):
-- eram recriadas a cada reinício do servidor, com senha publicada no repositório.
--
-- Rodadas por sorteio (README.md, Rodadas da Arena): consumível não muda a
-- distância. Ele multiplica a pontuação (scoreBonus.js) e soma um bônus de moedas
-- que nunca passa do preço (economy.js); a loja mostra os dois números. As
-- descrições dizem só isso, sem prometer efeito de jogo.

-- Itens da Loja
INSERT INTO shop_items (id, name, type, description, price, rarity, icon, flight_bonus, stock, is_active)
VALUES
  -- Jet Launcher. Este arquivo roda a cada boot com ON CONFLICT DO UPDATE: o
  -- flight_bonus tem de ser o mesmo da migration 020, senão a desfaria no restart.
  (
    'nitro_booster',
    'Nitro Booster',
    'nitro',
    'Pós-combustão de alto desempenho para o Jet Launcher. Consumido ao gerar a rodada: multiplica a pontuação e soma um bônus de moedas, sem alterar a distância sorteada.',
    50,
    'rare',
    '🔥',
    '{"effect": "boost", "activation": "active", "charges": 2, "durationTicks": 180, "magnitude": 1.6}'::jsonb,
    999,
    true
  ),
  (
    'shield_deflector',
    'Escudo Defletor',
    'shield',
    'Escudo defletor para o casco do jato. Consumido ao gerar a rodada: multiplica a pontuação e soma um bônus de moedas, sem alterar a distância sorteada.',
    20,
    'rare',
    '🛡️',
    '{"effect": "shield", "activation": "auto", "charges": 1}'::jsonb,
    999,
    true
  ),
  (
    'extra_fuel',
    'Tanque Extra',
    'fuel',
    'Tanque auxiliar para voos longos do Jet Launcher. Consumido ao gerar a rodada: multiplica a pontuação e soma um bônus de moedas, sem alterar a distância sorteada.',
    25,
    'epic',
    '⛽',
    '{"effect": "fuel_capacity", "activation": "passive", "magnitude": 1.4, "tradeoff": {"agility": -0.08}}'::jsonb,
    999,
    true
  ),
  (
    'flare_chaff',
    'Flares & Chaff',
    'defense',
    'Flares e chaff contra mísseis teleguiados. Consumido ao gerar a rodada: multiplica a pontuação e soma um bônus de moedas, sem alterar a distância sorteada.',
    30,
    'rare',
    '🎆',
    '{"effect": "countermeasure", "activation": "active", "charges": 3}'::jsonb,
    999,
    true
  ),
  (
    'emp_missile',
    'Míssil EMP',
    'attack',
    'Pulso EMP contra os drones da zona de combate. Consumido ao gerar a rodada: multiplica a pontuação e soma um bônus de moedas, sem alterar a distância sorteada.',
    35,
    'epic',
    '💥',
    '{"effect": "pulse", "activation": "active", "charges": 1, "magnitude": 600}'::jsonb,
    999,
    true
  ),
  (
    'vip_hangar',
    'Hangar VIP',
    'cosmetic',
    'Pintura holográfica e rastro prismático no Jet Launcher. Só visual: não muda pontuação nem moedas. (Permanente)',
    800,
    'legendary',
    '👑',
    '{"cosmetic": "holografico", "isPermanent": true}'::jsonb,
    999,
    true
  ),
  (
    'nos_injection',
    'Injeção de NOS',
    'nitro',
    'Garrafa dupla de óxido nitroso para o Neon Drifter. Consumido ao gerar a rodada: multiplica a pontuação e soma um bônus de moedas, sem alterar a distância sorteada.',
    50,
    'rare',
    '⚡',
    '{"boostSpeed": 1.6, "initialDistanceBonus": 400}'::jsonb,
    999,
    true
  ),
  (
    'drift_tires',
    'Pneus Radiais de Drift',
    'utility',
    'Pneus radiais de composto macio para derrapagens. Consumido ao gerar a rodada: multiplica a pontuação e soma um bônus de moedas, sem alterar a distância sorteada.',
    25,
    'common',
    '🛞',
    '{"driftControl": 1.4}'::jsonb,
    999,
    true
  ),
  (
    'emp_shield',
    'Escudo de Pulso EMP',
    'shield',
    'Pulso eletromagnético que abre caminho no tráfego. Consumido ao gerar a rodada: multiplica a pontuação e soma um bônus de moedas, sem alterar a distância sorteada.',
    20,
    'rare',
    '🌐',
    '{"absorbHits": 1}'::jsonb,
    999,
    true
  ),
  (
    'neon_garage',
    'Garagem Synthwave VIP',
    'cosmetic',
    'Underglow neon arco-íris pulsante no Neon Drifter. Só visual: não muda pontuação nem moedas. (Permanente)',
    800,
    'legendary',
    '🏎️',
    '{"scoreMultiplier": 1.5, "coinsMultiplier": 1.5, "isPermanent": true}'::jsonb,
    999,
    true
  ),
  (
    'quantum_jump',
    'Salto Quântico',
    'nitro',
    'Motor de dobra espacial para o Void Walker. Consumido ao gerar a rodada: multiplica a pontuação e soma um bônus de moedas, sem alterar a distância sorteada.',
    50,
    'epic',
    '🌀',
    '{"boostSpeed": 1.7, "initialDistanceBonus": 500}'::jsonb,
    999,
    true
  ),
  (
    'plasma_shield',
    'Escudo de Plasma Cósmico',
    'shield',
    'Barreira de plasma contra asteroides. Consumido ao gerar a rodada: multiplica a pontuação e soma um bônus de moedas, sem alterar a distância sorteada.',
    20,
    'rare',
    '🔮',
    '{"absorbHits": 1}'::jsonb,
    999,
    true
  ),
  (
    'dark_matter',
    'Matéria Escura Propulsora',
    'fuel',
    'Propulsor de matéria escura para expedições longas. Consumido ao gerar a rodada: multiplica a pontuação e soma um bônus de moedas, sem alterar a distância sorteada.',
    25,
    'epic',
    '🪐',
    '{"extraFuelPercent": 40}'::jsonb,
    999,
    true
  ),
  (
    'cosmo_skin',
    'Casco de Ouro Interestelar',
    'cosmetic',
    'Revestimento dourado anti-radiação no Void Walker. Só visual: não muda pontuação nem moedas. (Permanente)',
    800,
    'legendary',
    '✨',
    '{"scoreMultiplier": 1.5, "coinsMultiplier": 1.5, "isPermanent": true}'::jsonb,
    999,
    true
  ),
  (
    'life_pack',
    'Bateria de Vidas (+2 Vidas)',
    'lives',
    'Recarrega instantaneamente +2 vidas diárias para você continuar jogando na live.',
    -- Acima do que as 2 rodadas podem render na melhor base (2 × 65 moedas), senão
    -- recarregar vida vira lucro repetível. Ver services/economy.js.
    150,
    'common',
    '❤️',
    '{"extraLives": 2}'::jsonb,
    999,
    true
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price = EXCLUDED.price,
  icon = EXCLUDED.icon,
  flight_bonus = EXCLUDED.flight_bonus;

-- Catálogo atual: três consumíveis por jogo. Preserva referências históricas.
-- Retira os excedentes de venda sem apagar compras, inventários ou replays.
UPDATE shop_items
SET is_active = false
WHERE id IN ('flare_chaff', 'emp_missile', 'vip_hangar', 'neon_garage', 'cosmo_skin');
