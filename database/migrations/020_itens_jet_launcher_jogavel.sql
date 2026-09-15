-- Jet Launcher jogável.
--
-- Os itens deixam de ser bônus passivos aplicados na decolagem e passam a ter
-- momento de uso, lido pela simulação em games/sim (esquema de flight_bonus em
-- backend/src/services/sim/loadoutCodec.js). Os IDs são os mesmos: há inventários reais com eles.
--
-- O Hangar VIP perde o score ×1,5. Com o jogo dependendo de habilidade, um
-- multiplicador comprado tornaria o ranking comprável (decisão §11.1); quem já tem
-- o item mantém o visual holográfico.
--
-- database/seed.sql repete estes valores: ele roda a cada boot com ON CONFLICT DO
-- UPDATE e, diferente, desfaria esta migration no primeiro restart.

BEGIN;

UPDATE public.shop_items SET
  description = 'Pós-combustão na tecla de item: 3 s a +60% de velocidade, 2 cargas por partida. Anel atravessado no nitro vale o dobro. Gasta 4% de combustível por uso.',
  flight_bonus = '{"effect": "boost", "activation": "active", "charges": 2, "durationTicks": 180, "magnitude": 1.6}'::jsonb
WHERE id = 'nitro_booster';

UPDATE public.shop_items SET
  description = 'Absorve sozinho a primeira batida ou míssil. Se nada acertar o jato, volta para o inventário.',
  flight_bonus = '{"effect": "shield", "activation": "auto", "charges": 1}'::jsonb
WHERE id = 'shield_deflector';

UPDATE public.shop_items SET
  description = 'Tanque 40% maior durante o voo inteiro. O peso deixa o jato 8% menos ágil.',
  flight_bonus = '{"effect": "fuel_capacity", "activation": "passive", "magnitude": 1.4, "tradeoff": {"agility": -0.08}}'::jsonb
WHERE id = 'extra_fuel';

UPDATE public.shop_items SET
  description = 'Pintura holográfica e rastro prismático no Jet Launcher. Só visual: não muda pontuação nem moedas. (Permanente)',
  flight_bonus = '{"cosmetic": "holografico", "isPermanent": true}'::jsonb
WHERE id = 'vip_hangar';

INSERT INTO public.shop_items (id, name, type, description, price, rarity, icon, flight_bonus, stock, is_active, game_id)
VALUES
  (
    'flare_chaff',
    'Flares & Chaff',
    'defense',
    'Na tecla de item, quebra a trava de todos os mísseis no ar. 3 cargas por partida.',
    30,
    'rare',
    '🎆',
    '{"effect": "countermeasure", "activation": "active", "charges": 3}'::jsonb,
    999,
    true,
    'jet_launcher'
  ),
  (
    'emp_missile',
    'Míssil EMP',
    'attack',
    'Pulso em cone de 600 m à frente: derruba os drones do caminho (+100 pontos cada). 1 carga.',
    35,
    'epic',
    '💥',
    '{"effect": "pulse", "activation": "active", "charges": 1, "magnitude": 600}'::jsonb,
    999,
    true,
    'jet_launcher'
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  description = EXCLUDED.description,
  price = EXCLUDED.price,
  rarity = EXCLUDED.rarity,
  icon = EXCLUDED.icon,
  flight_bonus = EXCLUDED.flight_bonus,
  game_id = EXCLUDED.game_id;

COMMIT;
