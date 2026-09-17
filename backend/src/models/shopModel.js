const db = require('../config/database');
const InMemoryStore = require('../data/store');
const { comercializavel } = require('../services/gameCatalog');

// Compras e inventário da Arena vivem em ChannelInventoryModel (por canal). O
// inventário global que sobra aqui atende só o sandbox.
class ShopModel {
  static async findAllItems() {
    if (db.isAvailable()) {
      try {
        const query = `
          SELECT id, name, type, description, price, rarity, icon, flight_bonus, stock,
                 game_id AS "gameId"
          FROM shop_items
          WHERE is_active = true
          ORDER BY price ASC
        `;
        const { rows } = await db.query(query);
        return rows.filter((i) => comercializavel(i.id));
      } catch (err) {
        db.fallbackOrThrow(err, 'ShopModel.findAllItems');
      }
    }
    return InMemoryStore.shopItems.filter((i) => i.is_active && comercializavel(i.id));
  }

  static async findItemById(id) {
    if (db.isAvailable()) {
      try {
        const query = `
          SELECT id, name, type, description, price, rarity, icon, flight_bonus, stock, is_active,
                 game_id AS "gameId"
          FROM shop_items
          WHERE id = $1 AND is_active = true
        `;
        const { rows } = await db.query(query, [id]);
        return rows[0] || null;
      } catch (err) {
        db.fallbackOrThrow(err, 'ShopModel.findItemById');
      }
    }
    return InMemoryStore.shopItems.find((i) => i.id === id && i.is_active) || null;
  }

  static async findUserInventoryItem(userId, itemId) {
    if (db.isAvailable()) {
      try {
        const query = `
          SELECT item_id, quantity
          FROM user_inventory
          WHERE user_id = $1 AND item_id = $2
        `;
        const { rows } = await db.query(query, [userId, itemId]);
        if (rows[0]) return rows[0];
      } catch (err) {
        db.fallbackOrThrow(err, 'ShopModel.findUserInventoryItem');
      }
    }

    return (
      InMemoryStore.inventory.find((e) => e.user_id === userId && e.item_id === itemId) || null
    );
  }

  static async addItemToInventory(userId, itemId, quantity = 1, client = null) {
    if (db.isAvailable()) {
      try {
        const { rows } = await (client || db).query(
          `
          INSERT INTO user_inventory (user_id, item_id, quantity, updated_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (user_id, item_id)
          DO UPDATE SET quantity = user_inventory.quantity + EXCLUDED.quantity, updated_at = NOW()
          RETURNING *
        `,
          [userId, itemId, quantity]
        );
        if (rows[0]) return rows[0];
      } catch (err) {
        db.fallbackOrThrow(err, 'ShopModel.addItemToInventory');
      }
    }

    let inv = InMemoryStore.inventory.find((e) => e.user_id === userId && e.item_id === itemId);
    if (inv) {
      inv.quantity += quantity;
      inv.updated_at = new Date().toISOString();
    } else {
      inv = {
        user_id: userId,
        item_id: itemId,
        quantity,
        updated_at: new Date().toISOString()
      };
      InMemoryStore.inventory.push(inv);
    }
    return inv;
  }

  /**
   * Tira uma unidade do inventário para uma partida, só se houver. Condição no
   * próprio UPDATE pelo mesmo motivo de UserModel.consumeLife: conferir antes e
   * debitar depois deixaria duas partidas simultâneas reservarem a mesma unidade.
   *
   * @returns {Promise<boolean>} true se reservou.
   */
  static async reservarItem(userId, itemId, client = null) {
    if (db.isAvailable()) {
      try {
        const { rows } = await (client || db).query(
          `UPDATE user_inventory
           SET quantity = quantity - 1, updated_at = NOW()
           WHERE user_id = $1 AND item_id = $2 AND quantity >= 1
           RETURNING quantity`,
          [userId, itemId]
        );
        if (rows[0]) {
          const invMem = InMemoryStore.inventory.find(
            (e) => e.user_id === userId && e.item_id === itemId
          );
          if (invMem) invMem.quantity = rows[0].quantity;
        }
        return Boolean(rows[0]);
      } catch (err) {
        db.fallbackOrThrow(err, 'ShopModel.reservarItem');
      }
    }

    const inv = InMemoryStore.inventory.find((e) => e.user_id === userId && e.item_id === itemId);
    if (!inv || inv.quantity < 1) return false;
    inv.quantity -= 1;
    return true;
  }
}

module.exports = ShopModel;
