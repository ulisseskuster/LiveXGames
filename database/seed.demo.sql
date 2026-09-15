-- Dados de DEMONSTRAÇÃO — nunca aplicados em produção.
--
-- Contas com senha conhecida e versionada neste repositório público (demo123,
-- streamer123, TestSprite#2026!), carteiras pré-carregadas e os brindes de
-- exemplo do canal 'nightpilot'. Este arquivo existe para a suíte E2E e para
-- rodar a plataforma localmente sem cadastrar nada à mão.
--
-- Quem aplica: autoMigrate.runAutoMigration, apenas quando NODE_ENV !== 'production'.
-- O catálogo real da loja (shop_items) ficou em seed.sql, que roda sempre.


-- Usuários Iniciais (Senhas: demo123 para viewer/subscriber, streamer123 para nightpilot, admin123 para dev_admin)
INSERT INTO users (id, name, phone, username, email, password_hash, role, lives, max_lives, twitch_id, twitch_username, kick_id, kick_username, is_sub_twitch, is_sub_kick)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'Piloto Alpha Silva',
    '(11) 98765-4321',
    'viewer_alpha',
    'viewer_alpha@example.com',
    '$2b$10$z10rMP3ecSNUndp4UAkTGOPypYP94agG.ZzC0tjX/RtZsQUd1xky.',
    'viewer',
    3,
    3,
    NULL,
    NULL,
    NULL,
    NULL,
    false,
    false
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'Beta Subscritor Santos',
    '(21) 99887-6655',
    'sub_beta',
    'sub_beta@example.com',
    '$2b$10$z10rMP3ecSNUndp4UAkTGOPypYP94agG.ZzC0tjX/RtZsQUd1xky.',
    'subscriber',
    3,
    3,
    'ttv-98721',
    'sub_beta_ttv',
    NULL,
    NULL,
    true,
    false
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'Comandante NightPilot',
    '(31) 97766-5544',
    'nightpilot',
    'nightpilot@example.com',
    '$2b$10$YCvE7AG7IF9WFJ45wGjtQuUUW9iCAGPzPm2gi8QR21GtEp1uOVnU6',
    'streamer',
    999,
    999,
    'ttv-33333',
    'nightpilot',
    'kick-33333',
    'nightpilot_kick',
    false,
    false
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    'Administrador Oficial LiveX',
    '(11) 99999-0001',
    'admin_livex',
    'admin@livexgames.dev',
    '$2b$10$O4v8wzxo7.8qcCSr92TwM.YeKCskt9uwP9R6R5oXbA0DENgMxbkIS',
    'admin',
    999,
    999,
    'ttv-44444',
    'livex_admin',
    NULL,
    NULL,
    false,
    false
  ),
  (
    '55555555-5555-5555-5555-555555555555',
    'TestSprite QA Agent',
    '(11) 98888-7777',
    'testsprite_user',
    'testsprite@livexgames.dev',
    '$2b$10$tZ2E7/4L06uQyY407aY7OejY9FmOaQO5nC3Rcm5e0f769/Wl6/fKq',
    'viewer',
    3,
    3,
    NULL,
    NULL,
    NULL,
    NULL,
    false,
    false
  )
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username,
  name = EXCLUDED.name,
  phone = EXCLUDED.phone,
  role = EXCLUDED.role,
  max_lives = EXCLUDED.max_lives;

-- Carteiras
INSERT INTO wallets (user_id, balance, currency_code)
VALUES
  ('11111111-1111-1111-1111-111111111111', 1500, 'credits'),
  ('22222222-2222-2222-2222-222222222222', 5000, 'credits'),
  ('33333333-3333-3333-3333-333333333333', 99999, 'credits'),
  ('44444444-4444-4444-4444-444444444444', 99999, 'credits'),
  ('55555555-5555-5555-5555-555555555555', 50000, 'credits')
ON CONFLICT (user_id) DO NOTHING;

-- Fichas de Apoio iniciais para o usuário TestSprite com o streamer NightPilot
INSERT INTO streamer_wallets (user_id, streamer_id, balance, currency_code)
VALUES
  ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', 50000, 'fichas_apoio')
ON CONFLICT (user_id, streamer_id) DO NOTHING;

-- Brindes Iniciais da Lojinha do Streamer
INSERT INTO streamer_rewards (id, streamer_id, title, description, price_coins, stock, image_url, delivery_type, status, review_notes, reviewed_by, reviewed_at)
VALUES
  (
    'bbbbbbbb-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333333',
    'Camiseta Oficial NightPilot Cyberpunk 2026',
    'Camiseta algodão egípcio 100% com estampa holográfica exclusiva da live.',
    850,
    15,
    'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500&auto=format&fit=crop&q=60',
    'physical',
    'approved',
    'Aprovado pelo comitê técnico LiveX.',
    '44444444-4444-4444-4444-444444444444',
    NOW()
  ),
  (
    'bbbbbbbb-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
    'Vip Pass Discord + Salve em Vídeo 4K',
    'Cargo VIP perpétuo no Discord da comunidade com direito a salve gravado em 4K.',
    300,
    50,
    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500&auto=format&fit=crop&q=60',
    'digital',
    'approved',
    'Aprovado.',
    '44444444-4444-4444-4444-444444444444',
    NOW()
  ),
  (
    'bbbbbbbb-3333-3333-3333-333333333333',
    '33333333-3333-3333-3333-333333333333',
    'Boné Gamer NightPilot Bordado Aba Reta',
    'Boné preto bordado de alta densidade com fecho snapback regulável. Patrocínio oficial Jet Launcher.',
    950,
    20,
    'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=500&auto=format&fit=crop&q=60',
    'physical',
    'pending',
    NULL,
    NULL,
    NULL
  ),
  (
    'bbbbbbbb-4444-4444-4444-444444444444',
    '33333333-3333-3333-3333-333333333333',
    'Voucher de R$ 50 em Apostas Externas',
    'Código de saldo para apostas em plataforma de apostas de terceiros.',
    2000,
    5,
    'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=500&auto=format&fit=crop&q=60',
    'digital',
    'rejected',
    'Rejeitado: Conforme a Lei nº 14.790/2023 e diretrizes de compliance da LiveX Games, saldo financeiro em apostas ou cassinos externos é expressamente proibido como recompensa.',
    '44444444-4444-4444-4444-444444444444',
    NOW()
  )
ON CONFLICT (id) DO NOTHING;

