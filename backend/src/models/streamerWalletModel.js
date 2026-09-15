const { randomUUID } = require('crypto');
const db = require('../config/database');
const InMemoryStore = require('../data/store');

class StreamerWalletModel {
  static async findByUserAndStreamer(userId, streamerId) {
    if (db.isAvailable()) {
      try {
        const query = `
          SELECT id, user_id, streamer_id, balance, extra_lives, currency_code, updated_at
          FROM channel_wallets
          WHERE user_id = $1 AND streamer_id = $2
        `;
        const { rows } = await db.query(query, [userId, streamerId]);
        return (
          rows[0] || {
            user_id: userId,
            streamer_id: streamerId,
            balance: 0,
            extra_lives: 0,
            currency_code: 'credits'
          }
        );
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerWalletModel.findByUserAndStreamer');
      }
    }

    let wallet = InMemoryStore.channelWallets.find(
      (w) => w.user_id === userId && w.streamer_id === streamerId
    );
    if (!wallet) {
      wallet = {
        id: `sw-${userId}-${streamerId}`,
        user_id: userId,
        streamer_id: streamerId,
        balance: 0,
        currency_code: 'credits',
        updated_at: new Date().toISOString()
      };
      InMemoryStore.channelWallets.push(wallet);
    }
    return wallet;
  }

  static async addBalance(userId, streamerId, amount, metadata = {}) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('INVALID_AMOUNT');

    if (db.isAvailable()) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const result = await StreamerWalletModel.creditFromDonationAtomic(
          client,
          userId,
          streamerId,
          amount,
          metadata
        );
        await client.query('COMMIT');

        let memWallet = InMemoryStore.channelWallets.find(
          (w) => w.user_id === userId && w.streamer_id === streamerId
        );
        if (memWallet) memWallet.balance = result.balance;

        return { balance: result.balance };
      } catch (error) {
        await client.query('ROLLBACK');
        db.fallbackOrThrow(error, 'StreamerWalletModel.addBalance');
      } finally {
        client.release();
      }
    }

    let wallet = InMemoryStore.channelWallets.find(
      (w) => w.user_id === userId && w.streamer_id === streamerId
    );
    if (!wallet) {
      wallet = {
        id: `sw-${userId}-${streamerId}`,
        user_id: userId,
        streamer_id: streamerId,
        balance: 0,
        currency_code: 'credits',
        updated_at: new Date().toISOString()
      };
      InMemoryStore.channelWallets.push(wallet);
    }

    wallet.balance = Number(wallet.balance) + Number(amount);
    wallet.updated_at = new Date().toISOString();

    InMemoryStore.channelWalletTransactions.push({
      id: randomUUID(),
      user_id: userId,
      streamer_id: streamerId,
      item_id: null,
      type: metadata.type || 'donation',
      direction: 'credit',
      amount,
      status: 'completed',
      metadata,
      created_at: new Date().toISOString()
    });

    return { balance: wallet.balance };
  }

  /**
   * Crédito de doação DENTRO de uma transação já aberta. Quem chama controla o
   * BEGIN/COMMIT/ROLLBACK. Se algo falhar no fluxo da doação, o INSERT da
   * doação também reverte — P0-A resolvido de verdade.
   */
  static async creditFromDonationAtomic(client, userId, streamerId, amount, metadata = {}) {
    const { rows } = await client.query(
      `INSERT INTO channel_wallets (user_id, streamer_id, balance) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, streamer_id) DO UPDATE
       SET balance = channel_wallets.balance + EXCLUDED.balance, updated_at = NOW()
       RETURNING balance`,
      [userId, streamerId, amount]
    );
    const newBalance = Number(rows[0].balance);

    await client.query(
      `INSERT INTO channel_wallet_transactions (user_id, streamer_id, type, direction, amount, status, metadata)
       VALUES ($1, $2, $3, 'credit', $4, 'completed', $5)`,
      [userId, streamerId, metadata.type || 'donation', amount, JSON.stringify(metadata)]
    );

    return { balance: newBalance };
  }

  /** Já existe comprovante (extrato) de crédito para este external_id? */
  static async jaCreditado(userId, streamerId, externalId) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `SELECT 1 FROM channel_wallet_transactions
           WHERE user_id = $1 AND streamer_id = $2
             AND metadata->>'external_id' = $3
             AND direction = 'credit'
           LIMIT 1`,
          [userId, streamerId, externalId]
        );
        return rows.length > 0;
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerWalletModel.jaCreditado');
      }
    }
    return InMemoryStore.channelWalletTransactions.some(
      (t) =>
        t.user_id === userId &&
        t.streamer_id === streamerId &&
        t.metadata?.external_id === externalId &&
        t.direction === 'credit'
    );
  }

  static async debitBalance(userId, streamerId, amount, metadata = {}) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('INVALID_AMOUNT');

    if (db.isAvailable()) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const walletRes = await client.query(
          `SELECT id, balance FROM channel_wallets WHERE user_id = $1 AND streamer_id = $2 FOR UPDATE`,
          [userId, streamerId]
        );

        if (!walletRes.rows[0]) {
          throw new Error('WALLET_NOT_FOUND');
        }

        const currentBalance = Number(walletRes.rows[0].balance);
        if (currentBalance < amount) {
          throw new Error('INSUFFICIENT_BALANCE');
        }

        const newBalance = currentBalance - amount;
        await client.query(
          `UPDATE channel_wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2 AND streamer_id = $3`,
          [newBalance, userId, streamerId]
        );

        await client.query(
          `INSERT INTO channel_wallet_transactions (user_id, streamer_id, item_id, type, direction, amount, status, metadata)
           VALUES ($1, $2, $3, $4, 'debit', $5, 'completed', $6)`,
          [
            userId,
            streamerId,
            metadata.itemId || null,
            metadata.type || 'purchase',
            amount,
            JSON.stringify(metadata)
          ]
        );

        await client.query('COMMIT');

        let memWallet = InMemoryStore.channelWallets.find(
          (w) => w.user_id === userId && w.streamer_id === streamerId
        );
        if (memWallet) memWallet.balance = newBalance;

        return { balance: newBalance };
      } catch (error) {
        await client.query('ROLLBACK');
        if (error.message === 'INSUFFICIENT_BALANCE' || error.message === 'WALLET_NOT_FOUND') {
          throw error;
        }
        db.fallbackOrThrow(error, 'StreamerWalletModel.debitBalance');
      } finally {
        client.release();
      }
    }

    let wallet = InMemoryStore.channelWallets.find(
      (w) => w.user_id === userId && w.streamer_id === streamerId
    );
    if (!wallet) {
      throw new Error('WALLET_NOT_FOUND');
    }

    if (Number(wallet.balance) < Number(amount)) {
      throw new Error('INSUFFICIENT_BALANCE');
    }

    wallet.balance = Number(wallet.balance) - Number(amount);
    wallet.updated_at = new Date().toISOString();

    InMemoryStore.channelWalletTransactions.push({
      id: randomUUID(),
      user_id: userId,
      streamer_id: streamerId,
      item_id: metadata.itemId || null,
      type: metadata.type || 'purchase',
      direction: 'debit',
      amount,
      status: 'completed',
      metadata,
      created_at: new Date().toISOString()
    });

    return { balance: wallet.balance };
  }
}

module.exports = StreamerWalletModel;
