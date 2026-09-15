const StreamerWalletModel = require('../models/streamerWalletModel');
const { requireChannel } = require('./channelScope');

class StreamerWalletService {
  static async getBalance(userId, streamerId) {
    await requireChannel(streamerId);
    const wallet = await StreamerWalletModel.findByUserAndStreamer(userId, streamerId);
    return {
      userId,
      streamerId,
      balance: Number(wallet.balance),
      extraLives: Number(wallet.extra_lives || 0),
      currency_code: 'credits'
    };
  }

  // O canal é parte obrigatória da chave; a carteira antiga fica preservada.
  static async applyToLedgers(userId, streamerId, amount, metadata = {}, { debit = false } = {}) {
    await requireChannel(streamerId);
    const result = debit
      ? await StreamerWalletModel.debitBalance(userId, streamerId, amount, metadata)
      : await StreamerWalletModel.addBalance(userId, streamerId, amount, metadata);
    return { ...result, streamerId };
  }

  static async creditFromDonation(userId, streamerId, amount, metadata = {}) {
    return this.applyToLedgers(userId, streamerId, amount, { ...metadata, type: 'donation' });
  }

  static async creditFromRoulette(userId, streamerId, amount, metadata = {}) {
    return this.applyToLedgers(userId, streamerId, amount, { ...metadata, type: 'daily_roulette' });
  }

  /** Já existe comprovante de crédito para este external_id na carteira do canal? */
  static async jaCreditado(userId, streamerId, externalId) {
    return StreamerWalletModel.jaCreditado(userId, streamerId, externalId);
  }

  static async debitForRedemption(userId, streamerId, amount, metadata = {}) {
    return this.applyToLedgers(
      userId,
      streamerId,
      amount,
      { ...metadata, type: 'reward_redemption' },
      { debit: true }
    );
  }

  static async adminGrant(userId, streamerId, amount, adminId) {
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error('INVALID_AMOUNT: O valor concedido deve ser maior que zero');
    }
    return this.applyToLedgers(userId, streamerId, numAmount, {
      type: 'admin_grant',
      grantedBy: adminId
    });
  }
}

module.exports = StreamerWalletService;
