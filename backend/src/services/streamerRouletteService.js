const crypto = require('crypto');
const StreamerRouletteModel = require('../models/streamerRouletteModel');
const StreamerWalletService = require('./streamerWalletService');
const UserModel = require('../models/userModel');
const ChannelInventory = require('../models/channelInventoryModel');

// 8 Segmentos Futuristas e Balanceados da Roleta Diária
//
// Os prêmios em moedas estão calibrados para que o valor esperado de um giro
// fique em torno de UMA partida (~45 moedas, ver services/economy.js). A roleta
// é um empurrãozinho de engajamento diário, não uma fonte de renda paralela.
//
// Antes valia ~82 moedas por giro — e como o giro é POR STREAMER, a renda grátis
// crescia junto com o número de canais cadastrados: com 50 streamers na
// plataforma, eram ~4.100 moedas/dia sem jogar nada. O JACKPOT continua em 500
// (1% de chance) porque é ele que dá graça ao giro; o que baixou foram os
// prêmios comuns, que é onde a massa da moeda era emitida.
const WHEEL_SEGMENTS = [
  {
    id: 'fichas_15',
    type: 'fichas',
    name: '15 Moedas',
    amount: 15,
    icon: '🪙',
    label: '15 Moedas',
    game: 'Universal',
    color: '#059669', // Emerald Neon
    accent: '#10b981',
    weight: 30
  },
  {
    id: 'nitro_booster',
    type: 'item',
    itemId: 'nitro_booster',
    name: 'Nitro Booster (+350km/h)',
    amount: 1,
    icon: '🔥',
    label: 'Nitro Booster',
    game: 'Jet Launcher',
    color: '#ea580c', // Orange Fire
    accent: '#f97316',
    weight: 15
  },
  {
    id: 'fichas_40',
    type: 'fichas',
    name: '40 Moedas',
    amount: 40,
    icon: '🪙',
    label: '40 Moedas',
    game: 'Universal',
    color: '#0891b2', // Cyan Neon
    accent: '#06b6d4',
    weight: 20
  },
  {
    id: 'extra_life',
    type: 'extra_life',
    name: '+1 Vida Extra',
    amount: 1,
    icon: '❤️',
    label: '+1 Vida Extra',
    game: 'Universal',
    color: '#db2777', // Pink Choque
    accent: '#f43f5e',
    weight: 12
  },
  {
    id: 'nos_injection',
    type: 'item',
    itemId: 'nos_injection',
    name: 'Injeção de NOS (300km/h)',
    amount: 1,
    icon: '⚡',
    label: 'Injeção NOS',
    game: 'Neon Drifter',
    color: '#ca8a04', // Electric Gold
    accent: '#eab308',
    weight: 10
  },
  {
    id: 'shield_deflector',
    type: 'item',
    itemId: 'shield_deflector',
    name: 'Escudo Defletor Cinético',
    amount: 1,
    icon: '🛡️',
    label: 'Escudo',
    game: 'Jet Launcher',
    color: '#2563eb', // Cobalt Blue
    accent: '#3b82f6',
    weight: 7
  },
  {
    id: 'fichas_100',
    type: 'fichas',
    name: '100 Moedas',
    amount: 100,
    icon: '🪙',
    label: '100 Moedas',
    game: 'Universal',
    color: '#7c3aed', // Purple Neon
    accent: '#a855f7',
    weight: 5
  },
  {
    id: 'fichas_500',
    type: 'fichas',
    name: 'JACKPOT 500 Moedas!',
    amount: 500,
    icon: '👑',
    label: 'JACKPOT 500',
    game: 'Universal',
    color: '#b45309', // Golden Amber
    accent: '#f59e0b',
    weight: 1
  }
];

function nextMidnightIso() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return next.toISOString();
}

class StreamerRouletteService {
  static getWheelSegments() {
    return WHEEL_SEGMENTS;
  }

  static pickPrize(canReceiveExtraLife = true) {
    const eligibleIndices = [];
    let totalWeight = 0;

    WHEEL_SEGMENTS.forEach((segment, idx) => {
      if (!canReceiveExtraLife && segment.type === 'extra_life') return;
      eligibleIndices.push({ index: idx, segment, weight: segment.weight });
      totalWeight += segment.weight;
    });

    let roll = crypto.randomInt(0, totalWeight);
    for (const item of eligibleIndices) {
      if (roll < item.weight) {
        return { prize: item.segment, segmentIndex: item.index };
      }
      roll -= item.weight;
    }

    const fallback = eligibleIndices[eligibleIndices.length - 1];
    return { prize: fallback.segment, segmentIndex: fallback.index };
  }

  static async getStatus(userId, streamerId) {
    const todaySpin = await StreamerRouletteModel.findTodaySpin(userId, streamerId);
    return {
      canSpin: !todaySpin,
      lastPrize: todaySpin
        ? { type: todaySpin.prize_type, amount: todaySpin.prize_amount, itemId: todaySpin.item_id }
        : null,
      nextSpinAvailableAt: todaySpin ? nextMidnightIso() : null,
      segments: WHEEL_SEGMENTS.map((s) => ({
        id: s.id,
        type: s.type,
        name: s.name,
        amount: s.amount,
        itemId: s.itemId || null,
        icon: s.icon,
        label: s.label,
        game: s.game,
        color: s.color,
        accent: s.accent
      }))
    };
  }

  /**
   * Gira a roleta diária do canal.
   *
   * O parâmetro `isQA` saiu daqui: ele vinha de
   * `req.user.username === 'testsprite_user'` e desligava o limite de um giro por
   * dia para quem se chamasse assim — uma credencial de contorno permanente,
   * igual à que já havia sido removida de paymentController. A conta existia em
   * produção com senha versionada no repositório.
   */
  static async spin(userId, streamerId, io = null) {
    const streamer = await UserModel.findById(streamerId);
    if (!streamer || (streamer.role !== 'streamer' && streamer.role !== 'admin')) {
      throw new Error('STREAMER_NOT_FOUND: Streamer não encontrado');
    }

    const existingSpin = await StreamerRouletteModel.findTodaySpin(userId, streamerId);
    if (existingSpin) {
      throw new Error(
        'ALREADY_SPUN_TODAY: Você já girou a roleta desse streamer hoje. Volte amanhã!'
      );
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }

    const canReceiveExtraLife = user.lives < user.max_lives + 2;
    const { prize, segmentIndex } = this.pickPrize(canReceiveExtraLife);

    // Registra o giro ANTES de conceder o prêmio.
    //
    // É o UNIQUE (user_id, streamer_id, spin_date) que serializa o dia, e quem
    // perde a corrida recebe ALREADY_SPUN_TODAY daqui — sem prêmio. Na ordem
    // anterior o prêmio já tinha sido creditado quando o INSERT falhava: bastava
    // disparar giros em paralelo para o usuário ficar com N prêmios e um 409.
    await StreamerRouletteModel.recordSpin({
      userId,
      streamerId,
      prizeType: prize.type,
      prizeAmount: prize.amount,
      itemId: prize.itemId || null
    });

    // Giro reservado com exclusividade: agora o prêmio pode ser concedido.
    if (prize.type === 'item') {
      await ChannelInventory.add(userId, streamerId, prize.itemId, 1);
    } else if (prize.type === 'extra_life') {
      // acimaDoMaximo: o próprio critério de elegibilidade acima
      // (lives < max_lives + 2) já parte do princípio de que o saldo pode passar
      // do máximo. Sem isso, 12% dos giros entregavam nada a quem estava cheio.
      await ChannelInventory.addLives(userId, streamerId, 1);
    } else {
      await StreamerWalletService.creditFromRoulette(userId, streamerId, prize.amount, {
        source: 'daily_roulette'
      });
    }

    let prizeLabel;
    if (prize.type === 'item') {
      prizeLabel = `🎒 ${prize.icon} ${prize.name}`;
    } else if (prize.type === 'extra_life') {
      prizeLabel = '❤️ +1 Vida Extra';
    } else {
      prizeLabel = `🪙 ${prize.amount} Moedas`;
    }

    if (io) {
      io.emit('chat:new-message', {
        author: 'Sistema LiveX',
        role: 'admin',
        message: `🎡 ${user.username} girou a roleta diária de ${streamer.username} e ganhou ${prizeLabel}!`,
        timestamp: new Date().toISOString()
      });

      io.emit('streamer-roulette:won', {
        userId,
        username: user.username,
        streamerId,
        prizeType: prize.type,
        prizeAmount: prize.amount,
        itemId: prize.itemId || null,
        prizeLabel,
        segmentIndex
      });
    }

    return {
      success: true,
      message: 'Roleta girada com sucesso!',
      prize,
      segmentIndex,
      totalSegments: WHEEL_SEGMENTS.length,
      nextSpinAvailableAt: nextMidnightIso()
    };
  }
}

module.exports = StreamerRouletteService;
