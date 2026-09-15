const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/** Mesmo texto de database/seed.sql: consumível não muda a distância sorteada. */
const CONSUMIVEL =
  'Consumido ao gerar a rodada: multiplica a pontuação e soma um bônus de moedas, sem alterar a distância sorteada.';

/**
 * Senha da persona administrativa do modo sem banco.
 *
 * Sem ADMIN_PASSWORD no ambiente, cai num valor aleatório por processo — ou
 * seja, a conta existe mas ninguém consegue entrar nela. Antes havia aqui uma
 * senha literal, a mesma que estava no auto-migrador e neste repositório
 * público. As demais personas deste arquivo continuam com senha conhecida de
 * propósito: o InMemoryStore é o modo de demonstração, e é isso que permite
 * rodar a plataforma localmente sem cadastrar nada. A de admin é a exceção
 * porque dá acesso à moderação e ao painel de testes.
 */
/**
 * Em producao, nenhuma persona de demonstracao existe -- nem no modo sem banco.
 *
 * O InMemoryStore assume sempre que db.isAvailable() e falso, e isso inclui o
 * caso em que DATABASE_URL esta configurada mas o banco nao respondeu no
 * arranque: o servico sobe no "modo de resiliencia" que a pagina /status
 * anuncia. Com as personas embutidas, uma queda do Postgres em producao virava
 * um mundo paralelo onde 'nightpilot' (streamer), 'testsprite_user' (50.000
 * moedas) e 'viewer_alpha' entram com as senhas publicadas neste repositorio.
 *
 * Fora de producao elas continuam, porque e o que permite rodar a plataforma
 * localmente e as suites E2E sem cadastrar nada a mao.
 *
 * O efeito em producao e que uma queda do banco impede qualquer login. Para um
 * sistema que movimenta doacao e entrega brinde fisico, recusar acesso e a
 * falha correta -- melhor que atender com dados falsos que somem no proximo
 * deploy.
 */
const EM_PRODUCAO = process.env.NODE_ENV === 'production';
const demo = (registros) => (EM_PRODUCAO ? [] : registros);

const ADMIN_PASSWORD =
  (process.env.ADMIN_PASSWORD || '').trim() || crypto.randomBytes(24).toString('hex');

class InMemoryStore {
  static channelWallets = [];
  static channelWalletTransactions = [];
  static channelInventory = [];
  static users = demo([
    {
      id: '55555555-5555-5555-5555-555555555555',
      name: 'TestSprite QA Agent',
      phone: '(11) 98888-7777',
      username: 'testsprite_user',
      email: 'testsprite@livexgames.dev',
      passwordHash: bcrypt.hashSync('TestSprite#2026!', 10),
      role: 'viewer',
      lives: 3,
      max_lives: 3,
      last_life_refill: new Date().toISOString(),
      twitch_id: null,
      twitch_username: null,
      kick_id: null,
      kick_username: null,
      is_sub_twitch: false,
      is_sub_kick: false,
      created_at: new Date().toISOString()
    },
    {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Piloto Alpha Silva',
      phone: '(11) 98765-4321',
      username: 'viewer_alpha',
      email: 'viewer_alpha@example.com',
      passwordHash: bcrypt.hashSync('demo123', 10),
      role: 'viewer',
      lives: 3,
      max_lives: 3,
      last_life_refill: new Date().toISOString(),
      twitch_id: null,
      twitch_username: null,
      kick_id: null,
      kick_username: null,
      is_sub_twitch: false,
      is_sub_kick: false,
      created_at: new Date().toISOString()
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Beta Subscritor Santos',
      phone: '(21) 99887-6655',
      username: 'sub_beta',
      email: 'sub_beta@example.com',
      passwordHash: bcrypt.hashSync('demo123', 10),
      role: 'subscriber',
      lives: 3,
      max_lives: 3,
      last_life_refill: new Date().toISOString(),
      twitch_id: 'ttv-98721',
      twitch_username: 'sub_beta_ttv',
      kick_id: null,
      kick_username: null,
      is_sub_twitch: true,
      is_sub_kick: false,
      created_at: new Date().toISOString()
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      name: 'Comandante NightPilot',
      phone: '(31) 97766-5544',
      username: 'nightpilot',
      email: 'nightpilot@example.com',
      passwordHash: bcrypt.hashSync('streamer123', 10),
      role: 'streamer',
      lives: 999,
      max_lives: 999,
      last_life_refill: new Date().toISOString(),
      twitch_id: 'ttv-33333',
      twitch_username: 'nightpilot',
      kick_id: 'kick-33333',
      kick_username: 'nightpilot_kick',
      is_sub_twitch: false,
      is_sub_kick: false,
      created_at: new Date().toISOString()
    },
    {
      id: '44444444-4444-4444-4444-444444444444',
      name: 'Administrador Oficial LiveX',
      phone: '(11) 99999-0001',
      username: (process.env.ADMIN_USERNAME || 'admin_livex').trim(),
      email: `${(process.env.ADMIN_USERNAME || 'admin_livex').trim()}@livexgames.dev`,
      passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
      role: 'admin',
      lives: 999,
      max_lives: 999,
      last_life_refill: new Date().toISOString(),
      twitch_id: 'ttv-44444',
      twitch_username: 'livex_admin',
      kick_id: null,
      kick_username: null,
      is_sub_twitch: false,
      is_sub_kick: false,
      created_at: new Date().toISOString()
    }
  ]);

  static wallets = demo([
    {
      id: 'w-5555',
      user_id: '55555555-5555-5555-5555-555555555555',
      balance: 50000,
      currency_code: 'credits',
      updated_at: new Date().toISOString()
    },
    {
      id: 'w-1111',
      user_id: '11111111-1111-1111-1111-111111111111',
      balance: 1500,
      currency_code: 'credits',
      updated_at: new Date().toISOString()
    },
    {
      id: 'w-2222',
      user_id: '22222222-2222-2222-2222-222222222222',
      balance: 5000,
      currency_code: 'credits',
      updated_at: new Date().toISOString()
    },
    {
      id: 'w-3333',
      user_id: '33333333-3333-3333-3333-333333333333',
      balance: 99999,
      currency_code: 'credits',
      updated_at: new Date().toISOString()
    },
    {
      id: 'w-4444',
      user_id: '44444444-4444-4444-4444-444444444444',
      balance: 99999,
      currency_code: 'credits',
      updated_at: new Date().toISOString()
    }
  ]);

  static shopItems = [
    // 1. Itens Jet Launcher
    // Mesmos números de database/seed.sql e da migration 020.
    {
      id: 'nitro_booster',
      gameId: 'jet_launcher',
      name: 'Nitro Booster',
      type: 'nitro',
      description: `Pós-combustão de alto desempenho para o Jet Launcher. ${CONSUMIVEL}`,
      price: 50,
      rarity: 'rare',
      icon: '🔥',
      flight_bonus: {
        effect: 'boost',
        activation: 'active',
        charges: 2,
        durationTicks: 180,
        magnitude: 1.6
      },
      stock: 999,
      is_active: true
    },
    {
      id: 'shield_deflector',
      gameId: 'jet_launcher',
      name: 'Escudo Defletor',
      type: 'shield',
      description: `Escudo defletor para o casco do jato. ${CONSUMIVEL}`,
      price: 20,
      rarity: 'rare',
      icon: '🛡️',
      flight_bonus: { effect: 'shield', activation: 'auto', charges: 1 },
      stock: 999,
      is_active: true
    },
    {
      id: 'extra_fuel',
      gameId: 'jet_launcher',
      name: 'Tanque Extra',
      type: 'fuel',
      description: `Tanque auxiliar para voos longos do Jet Launcher. ${CONSUMIVEL}`,
      price: 25,
      rarity: 'epic',
      icon: '⛽',
      flight_bonus: {
        effect: 'fuel_capacity',
        activation: 'passive',
        magnitude: 1.4,
        tradeoff: { agility: -0.08 }
      },
      stock: 999,
      is_active: true
    },
    {
      id: 'flare_chaff',
      gameId: 'jet_launcher',
      name: 'Flares & Chaff',
      type: 'defense',
      description: `Flares e chaff contra mísseis teleguiados. ${CONSUMIVEL}`,
      price: 30,
      rarity: 'rare',
      icon: '🎆',
      flight_bonus: { effect: 'countermeasure', activation: 'active', charges: 3 },
      stock: 999,
      is_active: false
    },
    {
      id: 'emp_missile',
      gameId: 'jet_launcher',
      name: 'Míssil EMP',
      type: 'attack',
      description: `Pulso EMP contra os drones da zona de combate. ${CONSUMIVEL}`,
      price: 35,
      rarity: 'epic',
      icon: '💥',
      flight_bonus: { effect: 'pulse', activation: 'active', charges: 1, magnitude: 600 },
      stock: 999,
      is_active: false
    },
    {
      id: 'vip_hangar',
      gameId: 'jet_launcher',
      name: 'Hangar VIP',
      type: 'cosmetic',
      description:
        'Pintura holográfica e rastro prismático no Jet Launcher. Só visual: não muda pontuação nem moedas. (Permanente)',
      price: 800,
      rarity: 'legendary',
      icon: '👑',
      flight_bonus: { cosmetic: 'holografico' },
      stock: 999,
      is_permanent: true,
      is_active: false
    },
    // 2. Itens Neon Drifter
    {
      id: 'nos_injection',
      gameId: 'neon_drifter',
      name: 'Injeção de NOS',
      type: 'nitro',
      description: `Garrafa dupla de óxido nitroso para o Neon Drifter. ${CONSUMIVEL}`,
      price: 50,
      rarity: 'rare',
      icon: '⚡',
      flight_bonus: { boostSpeed: 1.6, initialDistanceBonus: 400 },
      stock: 999,
      is_active: true
    },
    {
      id: 'drift_tires',
      gameId: 'neon_drifter',
      name: 'Pneus Radiais de Drift',
      type: 'utility',
      description: `Pneus radiais de composto macio para derrapagens. ${CONSUMIVEL}`,
      price: 25,
      rarity: 'common',
      icon: '🛞',
      flight_bonus: { driftControl: 1.4 },
      stock: 999,
      is_active: true
    },
    {
      id: 'emp_shield',
      gameId: 'neon_drifter',
      name: 'Escudo de Pulso EMP',
      type: 'shield',
      description: `Pulso eletromagnético que abre caminho no tráfego. ${CONSUMIVEL}`,
      price: 20,
      rarity: 'rare',
      icon: '🌐',
      flight_bonus: { absorbHits: 1 },
      stock: 999,
      is_active: true
    },
    {
      id: 'neon_garage',
      gameId: 'neon_drifter',
      name: 'Garagem Synthwave VIP',
      type: 'cosmetic',
      description:
        'Underglow neon arco-íris pulsante no Neon Drifter. Só visual: não muda pontuação nem moedas. (Permanente)',
      price: 800,
      rarity: 'legendary',
      icon: '🏎️',
      flight_bonus: { scoreMultiplier: 1.5, coinsMultiplier: 1.5 },
      stock: 999,
      is_permanent: true,
      is_active: false
    },
    // 3. Itens Void Walker
    {
      id: 'quantum_jump',
      gameId: 'void_walker',
      name: 'Salto Quântico',
      type: 'nitro',
      description: `Motor de dobra espacial para o Void Walker. ${CONSUMIVEL}`,
      price: 50,
      rarity: 'epic',
      icon: '🌀',
      flight_bonus: { boostSpeed: 1.7, initialDistanceBonus: 500 },
      stock: 999,
      is_active: true
    },
    {
      id: 'plasma_shield',
      gameId: 'void_walker',
      name: 'Escudo de Plasma Cósmico',
      type: 'shield',
      description: `Barreira de plasma contra asteroides. ${CONSUMIVEL}`,
      price: 20,
      rarity: 'rare',
      icon: '🔮',
      flight_bonus: { absorbHits: 1 },
      stock: 999,
      is_active: true
    },
    {
      id: 'dark_matter',
      gameId: 'void_walker',
      name: 'Matéria Escura Propulsora',
      type: 'fuel',
      description: `Propulsor de matéria escura para expedições longas. ${CONSUMIVEL}`,
      price: 25,
      rarity: 'epic',
      icon: '🪐',
      flight_bonus: { extraFuelPercent: 40 },
      stock: 999,
      is_active: true
    },
    {
      id: 'cosmo_skin',
      gameId: 'void_walker',
      name: 'Casco de Ouro Interestelar',
      type: 'cosmetic',
      description:
        'Revestimento dourado anti-radiação no Void Walker. Só visual: não muda pontuação nem moedas. (Permanente)',
      price: 800,
      rarity: 'legendary',
      icon: '✨',
      flight_bonus: { scoreMultiplier: 1.5, coinsMultiplier: 1.5 },
      stock: 999,
      is_permanent: true,
      is_active: false
    },
    // 5. Recarga Tática de Vidas
    {
      id: 'life_pack',
      gameId: 'all',
      name: 'Bateria de Vidas (+2 Vidas)',
      type: 'lives',
      description:
        'Recarrega instantaneamente +2 vidas diárias para você continuar jogando na live.',
      // Acima do que as 2 partidas rendem (~90 moedas): recarregar vida compra
      // tempo de jogo, nunca moeda. Ver migrations/008_reprice_shop_new_economy.sql.
      price: 150,
      rarity: 'common',
      icon: '❤️',
      flight_bonus: { extraLives: 2 },
      stock: 999,
      is_active: true
    }
  ];

  static inventory = demo([
    {
      id: 'inv-1',
      user_id: '11111111-1111-1111-1111-111111111111',
      item_id: 'nitro_booster',
      quantity: 2,
      updated_at: new Date().toISOString()
    },
    {
      id: 'inv-2',
      user_id: '11111111-1111-1111-1111-111111111111',
      item_id: 'shield_deflector',
      quantity: 1,
      updated_at: new Date().toISOString()
    }
  ]);

  static transactions = [];
  static donations = [];
  static donationReactions = [];
  static streamerWallets = demo([
    {
      id: 'sw-seed-5',
      user_id: '55555555-5555-5555-5555-555555555555',
      streamer_id: '33333333-3333-3333-3333-333333333333',
      balance: 50000,
      currency_code: 'fichas_apoio',
      updated_at: new Date().toISOString()
    },
    {
      id: 'sw-seed-1',
      user_id: '11111111-1111-1111-1111-111111111111',
      streamer_id: '33333333-3333-3333-3333-333333333333',
      balance: 1500,
      currency_code: 'fichas_apoio',
      updated_at: new Date().toISOString()
    },
    {
      id: 'sw-seed-2',
      user_id: '22222222-2222-2222-2222-222222222222',
      streamer_id: '33333333-3333-3333-3333-333333333333',
      balance: 5000,
      currency_code: 'fichas_apoio',
      updated_at: new Date().toISOString()
    }
  ]);
  static streamerWalletTransactions = [];
  static streamerPaymentConfigs = [];
  static streamerApplications = [];
  static streamerRouletteSpins = [];
  // Notificações push PWA (ver models/notificationModel.js). Sem seed de demo:
  // inscrição push e notificação são estado do usuário, não conteúdo.
  static pushSubscriptions = [];
  static notifications = [];
  // Streak diário (ver models/streakModel.js). Estado do usuário, sem seed.
  static userStreaks = [];
  // Partidas do modelo novo (ver models/gameRunModel.js). Sem seed de demo:
  // partida aberta é estado transitório, não conteúdo.
  static gameRuns = [];
  static flightRuns = demo([
    {
      id: 'run-seed-1',
      user_id: '11111111-1111-1111-1111-111111111111',
      game_id: 'jet_launcher',
      distance: 2450.5,
      max_altitude: 820.0,
      score: 3270,
      coins_earned: 120,
      items_used: ['nitro_booster'],
      flight_script: [],
      created_at: new Date(Date.now() - 3600000).toISOString()
    },
    {
      id: 'run-seed-2',
      user_id: '22222222-2222-2222-2222-222222222222',
      game_id: 'jet_launcher',
      distance: 3890.0,
      max_altitude: 1250.0,
      score: 5120,
      coins_earned: 250,
      items_used: ['nitro_booster', 'extra_fuel'],
      flight_script: [],
      created_at: new Date(Date.now() - 7200000).toISOString()
    }
  ]);

  static streamerRewards = demo([
    {
      id: 'rew-seed-1',
      streamer_id: '33333333-3333-3333-3333-333333333333',
      streamer_username: 'nightpilot',
      title: 'Camiseta Oficial LiveX Pilot 2026',
      description:
        'Camiseta premium 100% algodão egípcio com estampa holográfica oficial da live. Tamanhos P ao GG.',
      price_coins: 1200,
      stock: 15,
      image_url:
        'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500&auto=format&fit=crop&q=60',
      delivery_type: 'physical',
      status: 'approved',
      review_notes:
        'Aprovado pelo time de desenvolvimento LiveX Games. Produto oficial verificado.',
      reviewed_by: '44444444-4444-4444-4444-444444444444',
      reviewed_at: new Date(Date.now() - 86400000).toISOString(),
      created_at: new Date(Date.now() - 172800000).toISOString()
    },
    {
      id: 'rew-seed-2',
      streamer_id: '33333333-3333-3333-3333-333333333333',
      streamer_username: 'nightpilot',
      title: 'VIP Pass Discord + Badge Exclusiva Hangar',
      description:
        'Acesso vitalício à sala VIP de voz e texto no Discord do NightPilot com cargo exclusivo e direito a jogar partidas cooperativas em live.',
      price_coins: 600,
      stock: 48,
      image_url:
        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500&auto=format&fit=crop&q=60',
      delivery_type: 'digital',
      status: 'approved',
      review_notes: 'Chaves e acesso digital auditados e em conformidade.',
      reviewed_by: '44444444-4444-4444-4444-444444444444',
      reviewed_at: new Date(Date.now() - 43200000).toISOString(),
      created_at: new Date(Date.now() - 86400000).toISOString()
    },
    {
      id: 'rew-seed-3',
      streamer_id: '33333333-3333-3333-3333-333333333333',
      streamer_username: 'nightpilot',
      title: 'Boné Gamer NightPilot Bordado Aba Reta',
      description:
        'Boné preto bordado de alta densidade com fecho snapback regulável. Patrocínio oficial Jet Launcher.',
      price_coins: 950,
      stock: 20,
      image_url:
        'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=500&auto=format&fit=crop&q=60',
      delivery_type: 'physical',
      status: 'pending',
      review_notes: null,
      reviewed_by: null,
      reviewed_at: null,
      created_at: new Date(Date.now() - 3600000).toISOString()
    },
    {
      id: 'rew-seed-4',
      streamer_id: '33333333-3333-3333-3333-333333333333',
      streamer_username: 'nightpilot',
      title: 'Voucher de R$ 50 em Apostas Externas',
      description: 'Código de saldo para apostas em plataforma de apostas de terceiros.',
      price_coins: 2000,
      stock: 5,
      image_url:
        'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=500&auto=format&fit=crop&q=60',
      delivery_type: 'digital',
      status: 'rejected',
      review_notes:
        'Rejeitado: Conforme a Lei nº 14.790/2023 e diretrizes de compliance e segurança da LiveX Games, saldo financeiro em apostas ou cassinos externos é expressamente proibido como recompensa.',
      reviewed_by: '44444444-4444-4444-4444-444444444444',
      reviewed_at: new Date(Date.now() - 7200000).toISOString(),
      created_at: new Date(Date.now() - 14400000).toISOString()
    }
  ]);

  static rewardRedemptions = demo([
    {
      id: 'red-seed-1',
      reward_id: 'rew-seed-2',
      reward_title: 'VIP Pass Discord + Badge Exclusiva Hangar',
      streamer_id: '33333333-3333-3333-3333-333333333333',
      user_id: '11111111-1111-1111-1111-111111111111',
      username: 'viewer_alpha',
      coins_spent: 600,
      delivery_type: 'digital',
      recipient_name: 'Alpha Viewer',
      shipping_address: null,
      digital_code: 'LIVEX-DISCORD-VIP-7992-ALPHA',
      status: 'completed',
      tracking_code: null,
      created_at: new Date(Date.now() - 3600000).toISOString(),
      updated_at: new Date(Date.now() - 3600000).toISOString()
    }
  ]);

  static seedDemoViewer() {
    const existing = this.users.find((u) => u.username === 'viewer_alpha');
    if (existing) return existing;

    const user = {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Piloto Alpha Silva',
      phone: '(11) 98765-4321',
      username: 'viewer_alpha',
      email: 'viewer_alpha@example.com',
      passwordHash: bcrypt.hashSync('demo123', 10),
      role: 'viewer',
      lives: 3,
      max_lives: 3,
      last_life_refill: new Date().toISOString(),
      twitch_id: null,
      twitch_username: null,
      kick_id: null,
      kick_username: null,
      is_sub_twitch: false,
      is_sub_kick: false,
      created_at: new Date().toISOString()
    };
    this.users.unshift(user);

    if (!this.wallets.some((w) => w.user_id === user.id)) {
      this.wallets.unshift({
        id: 'w-1111',
        user_id: user.id,
        balance: 1500,
        currency_code: 'credits',
        updated_at: new Date().toISOString()
      });
    }
    return user;
  }
}

module.exports = InMemoryStore;
