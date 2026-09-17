const { randomUUID } = require('crypto');
const db = require('../config/database');
const store = require('../data/store');
const Wallet = require('./streamerWalletModel');

const matches = (userId, streamerId, itemId) => (row) =>
  row.user_id === userId &&
  row.streamer_id === streamerId &&
  (itemId === undefined || row.item_id === itemId);

class ChannelInventoryModel {
  static async list(userId, streamerId) {
    if (db.isAvailable()) {
      const { rows } = await db.query(
        `SELECT i.item_id, i.quantity, s.name, s.type, s.description, s.icon,
                s.flight_bonus, s.game_id
         FROM channel_inventory i JOIN shop_items s ON s.id = i.item_id
         WHERE i.user_id = $1 AND i.streamer_id = $2 AND i.quantity > 0`,
        [userId, streamerId]
      );
      return rows;
    }
    return store.channelInventory
      .filter(matches(userId, streamerId))
      .filter((i) => i.quantity > 0)
      .map((i) => {
        const item = store.shopItems.find((s) => s.id === i.item_id) || {};
        return { ...item, ...i, game_id: item.gameId || item.game_id || 'all' };
      });
  }

  // `client` opcional: quando vem, a escrita entra na transação de quem chamou
  // (abertura/estorno de rodada). Sem ele, cada chamada é autocommit.
  static async add(userId, streamerId, itemId, quantity = 1, client = null) {
    if (db.isAvailable()) {
      const { rows } = await (client || db).query(
        `INSERT INTO channel_inventory (user_id, streamer_id, item_id, quantity)
         VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, streamer_id, item_id)
         DO UPDATE SET quantity = channel_inventory.quantity + EXCLUDED.quantity, updated_at = NOW()
         RETURNING *`,
        [userId, streamerId, itemId, quantity]
      );
      return rows[0];
    }
    let row = store.channelInventory.find(matches(userId, streamerId, itemId));
    if (!row) {
      row = { user_id: userId, streamer_id: streamerId, item_id: itemId, quantity: 0 };
      store.channelInventory.push(row);
    }
    row.quantity += quantity;
    return row;
  }

  static async reserve(userId, streamerId, itemId, client = null) {
    if (db.isAvailable()) {
      const { rows } = await (client || db).query(
        `UPDATE channel_inventory SET quantity = quantity - 1, updated_at = NOW()
         WHERE user_id = $1 AND streamer_id = $2 AND item_id = $3 AND quantity > 0
         RETURNING quantity`,
        [userId, streamerId, itemId]
      );
      return Boolean(rows[0]);
    }
    const row = store.channelInventory.find(matches(userId, streamerId, itemId));
    if (!row || row.quantity < 1) return false;
    row.quantity--;
    return true;
  }

  static async addLives(userId, streamerId, quantity, client = null) {
    if (db.isAvailable()) {
      await (client || db).query(
        `INSERT INTO channel_wallets (user_id, streamer_id, extra_lives) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, streamer_id) DO UPDATE
         SET extra_lives = channel_wallets.extra_lives + EXCLUDED.extra_lives`,
        [userId, streamerId, quantity]
      );
      return;
    }
    const wallet = await Wallet.findByUserAndStreamer(userId, streamerId);
    wallet.extra_lives = Number(wallet.extra_lives || 0) + quantity;
  }

  static async consumeLife(userId, streamerId, client = null) {
    if (db.isAvailable()) {
      const { rows } = await (client || db).query(
        `UPDATE channel_wallets SET extra_lives = extra_lives - 1
         WHERE user_id = $1 AND streamer_id = $2 AND extra_lives > 0 RETURNING extra_lives`,
        [userId, streamerId]
      );
      return Boolean(rows[0]);
    }
    const wallet = store.channelWallets.find(matches(userId, streamerId));
    if (!wallet || !(wallet.extra_lives > 0)) return false;
    wallet.extra_lives--;
    return true;
  }

  // Saldo, inventário/vidas e lançamento contábil pertencem à mesma transação.
  static async purchase(userId, streamerId, item, quantity) {
    const total = Number(item.price) * quantity;
    if (!Number.isSafeInteger(total) || total <= 0) throw new Error('INVALID_QUANTITY');
    const lives = item.id === 'life_pack' ? (item.flight_bonus?.extraLives || 2) * quantity : 0;
    let balance;
    if (db.isAvailable()) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `UPDATE channel_wallets SET balance = balance - $3, extra_lives = extra_lives + $4,
           updated_at = NOW() WHERE user_id = $1 AND streamer_id = $2 AND balance >= $3
           RETURNING balance`,
          [userId, streamerId, total, lives]
        );
        if (!rows[0]) throw new Error('INSUFFICIENT_BALANCE');
        balance = Number(rows[0].balance);
        if (!lives)
          await client.query(
            `INSERT INTO channel_inventory (user_id, streamer_id, item_id, quantity)
           VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, streamer_id, item_id)
           DO UPDATE SET quantity = channel_inventory.quantity + EXCLUDED.quantity, updated_at = NOW()`,
            [userId, streamerId, item.id, quantity]
          );
        await client.query(
          `INSERT INTO channel_wallet_transactions
           (user_id, streamer_id, item_id, type, direction, amount, metadata)
           VALUES ($1, $2, $3, 'purchase', 'debit', $4, $5)`,
          [userId, streamerId, item.id, total, JSON.stringify({ quantity, itemName: item.name })]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } else {
      const wallet = store.channelWallets.find(matches(userId, streamerId));
      if (!wallet || Number(wallet.balance) < total) throw new Error('INSUFFICIENT_BALANCE');
      // Não há await entre a checagem do saldo e as mutações em memória.
      balance = wallet.balance = Number(wallet.balance) - total;
      if (lives) wallet.extra_lives = Number(wallet.extra_lives || 0) + lives;
      else {
        const row = store.channelInventory.find(matches(userId, streamerId, item.id));
        if (row) row.quantity += quantity;
        else
          store.channelInventory.push({
            user_id: userId,
            streamer_id: streamerId,
            item_id: item.id,
            quantity
          });
      }
      store.channelWalletTransactions.push({
        id: randomUUID(),
        user_id: userId,
        streamer_id: streamerId,
        item_id: item.id,
        type: 'purchase',
        direction: 'debit',
        amount: total,
        metadata: { quantity },
        created_at: new Date().toISOString()
      });
    }
    return {
      success: true,
      streamerId,
      balance,
      itemId: item.id,
      itemName: item.name,
      quantity,
      total
    };
  }
}

module.exports = ChannelInventoryModel;
