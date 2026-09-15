const { randomUUID } = require('crypto');
const db = require('../config/database');
const InMemoryStore = require('../data/store');

class WalletModel {
  static async findByUserId(userId) {
    if (db.isAvailable()) {
      try {
        const query = `
          SELECT id, user_id, balance, currency_code, updated_at
          FROM wallets
          WHERE user_id = $1
        `;
        const { rows } = await db.query(query, [userId]);
        if (rows[0]) return rows[0];
      } catch (err) {
        db.fallbackOrThrow(err, 'WalletModel.findByUserId');
      }
    }

    let wallet = InMemoryStore.wallets.find((w) => w.user_id === userId);
    if (!wallet) {
      wallet = {
        id: `w-${userId}`,
        user_id: userId,
        balance: 0,
        currency_code: 'credits',
        updated_at: new Date().toISOString()
      };
      InMemoryStore.wallets.push(wallet);
    }
    return wallet;
  }

  static async addCredits(userId, amount, metadata = {}) {
    if (amount <= 0) throw new Error('INVALID_AMOUNT');

    if (db.isAvailable()) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        let walletRes = await client.query(
          `SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE`,
          [userId]
        );

        let newBalance = amount;
        if (walletRes.rows[0]) {
          newBalance = Number(walletRes.rows[0].balance) + Number(amount);
          await client.query(
            `UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2`,
            [newBalance, userId]
          );
        } else {
          await client.query(
            `INSERT INTO wallets (user_id, balance, currency_code) VALUES ($1, $2, 'credits')`,
            [userId, newBalance]
          );
        }

        await client.query(
          `INSERT INTO transactions (user_id, type, direction, amount, currency_code, status, metadata)
           VALUES ($1, $2, 'credit', $3, 'credits', 'completed', $4)`,
          [userId, metadata.type || 'donation', amount, JSON.stringify(metadata)]
        );

        await client.query('COMMIT');

        // Sincroniza em memória
        let memWallet = InMemoryStore.wallets.find((w) => w.user_id === userId);
        if (memWallet) memWallet.balance = newBalance;

        return { balance: newBalance };
      } catch (error) {
        await client.query('ROLLBACK');
        db.fallbackOrThrow(error, 'WalletModel.addCredits');
      } finally {
        client.release();
      }
    }

    // Fallback InMemoryStore
    let wallet = InMemoryStore.wallets.find((w) => w.user_id === userId);
    if (!wallet) {
      wallet = {
        id: `w-${userId}`,
        user_id: userId,
        balance: 0,
        currency_code: 'credits',
        updated_at: new Date().toISOString()
      };
      InMemoryStore.wallets.push(wallet);
    }

    wallet.balance = Number(wallet.balance) + Number(amount);
    wallet.updated_at = new Date().toISOString();

    InMemoryStore.transactions.push({
      id: randomUUID(),
      user_id: userId,
      item_id: null,
      type: metadata.type || 'donation',
      direction: 'credit',
      amount,
      currency_code: 'credits',
      status: 'completed',
      metadata,
      created_at: new Date().toISOString()
    });

    return { balance: wallet.balance };
  }
}

module.exports = WalletModel;
