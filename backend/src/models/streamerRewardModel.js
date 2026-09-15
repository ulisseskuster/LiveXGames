const { randomUUID } = require('crypto');
const db = require('../config/database');
const InMemoryStore = require('../data/store');

class StreamerRewardModel {
  static async createReward({
    streamer_id,
    streamer_username,
    title,
    description,
    price_coins,
    stock,
    image_url,
    delivery_type
  }) {
    const numericPrice = Number(price_coins);
    const numericStock = Number(stock);

    if (db.isAvailable()) {
      try {
        const query = `
          INSERT INTO streamer_rewards (
            streamer_id, title, description, price_coins, stock, image_url, delivery_type, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
          RETURNING id, streamer_id, title, description, price_coins, stock, image_url, delivery_type, status, created_at
        `;
        const values = [
          streamer_id,
          title,
          description,
          numericPrice,
          numericStock,
          image_url,
          delivery_type
        ];
        const { rows } = await db.query(query, values);
        if (rows[0]) {
          return { ...rows[0], streamer_username };
        }
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerRewardModel.createReward');
      }
    }

    const newReward = {
      id: randomUUID(),
      streamer_id,
      streamer_username: streamer_username || 'streamer',
      title,
      description,
      price_coins: numericPrice,
      stock: numericStock,
      image_url,
      delivery_type: delivery_type || 'physical',
      status: 'pending',
      review_notes: null,
      reviewed_by: null,
      reviewed_at: null,
      created_at: new Date().toISOString()
    };

    InMemoryStore.streamerRewards.unshift(newReward);
    return newReward;
  }

  static async findById(id) {
    if (db.isAvailable()) {
      try {
        const query = `
          SELECT r.*, u.username AS streamer_username
          FROM streamer_rewards r
          LEFT JOIN users u ON r.streamer_id = u.id
          WHERE r.id = $1
        `;
        const { rows } = await db.query(query, [id]);
        if (rows[0]) return rows[0];
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerRewardModel.findById');
      }
    }

    return InMemoryStore.streamerRewards.find((r) => r.id === id) || null;
  }

  static async findApprovedRewards(streamerId = null, deliveryType = null) {
    if (db.isAvailable()) {
      try {
        let query = `
          SELECT r.*, u.username AS streamer_username
          FROM streamer_rewards r
          LEFT JOIN users u ON r.streamer_id = u.id
          WHERE r.status = 'approved' AND r.stock > 0
        `;
        const params = [];
        if (streamerId) {
          params.push(streamerId);
          query += ` AND r.streamer_id = $${params.length}`;
        }
        if (deliveryType && ['physical', 'digital'].includes(deliveryType)) {
          params.push(deliveryType);
          query += ` AND r.delivery_type = $${params.length}`;
        }
        query += ` ORDER BY r.created_at DESC`;

        const { rows } = await db.query(query, params);
        if (rows) return rows;
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerRewardModel.findApprovedRewards');
      }
    }

    return InMemoryStore.streamerRewards
      .filter((r) => {
        const matchesStatus = r.status === 'approved';
        const matchesStock = r.stock > 0;
        const matchesStreamer = !streamerId || r.streamer_id === streamerId;
        const matchesType = !deliveryType || r.delivery_type === deliveryType;
        return matchesStatus && matchesStock && matchesStreamer && matchesType;
      })
      .map((r) => {
        const streamer = InMemoryStore.users.find((u) => u.id === r.streamer_id);
        return {
          ...r,
          streamer_username: r.streamer_username || (streamer ? streamer.username : 'streamer')
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  static async findRewardsByStreamer(streamerId) {
    if (db.isAvailable()) {
      try {
        const query = `
          SELECT r.*, u.username AS reviewer_username
          FROM streamer_rewards r
          LEFT JOIN users u ON r.reviewed_by = u.id
          WHERE r.streamer_id = $1
          ORDER BY r.created_at DESC
        `;
        const { rows } = await db.query(query, [streamerId]);
        if (rows) return rows;
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerRewardModel.findRewardsByStreamer');
      }
    }

    return InMemoryStore.streamerRewards
      .filter((r) => r.streamer_id === streamerId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  static async findRewardsForModeration(statusFilter = null) {
    if (db.isAvailable()) {
      try {
        let query = `
          SELECT r.*, u.username AS streamer_username, rev.username AS reviewer_username
          FROM streamer_rewards r
          LEFT JOIN users u ON r.streamer_id = u.id
          LEFT JOIN users rev ON r.reviewed_by = rev.id
        `;
        const params = [];
        if (statusFilter && statusFilter !== 'all') {
          params.push(statusFilter);
          query += ` WHERE r.status = $1`;
        }
        query += ` ORDER BY r.created_at DESC`;

        const { rows } = await db.query(query, params);
        if (rows) return rows;
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerRewardModel.findRewardsForModeration');
      }
    }

    return InMemoryStore.streamerRewards
      .filter((r) => !statusFilter || statusFilter === 'all' || r.status === statusFilter)
      .map((r) => {
        const streamer = InMemoryStore.users.find((u) => u.id === r.streamer_id);
        const reviewer = InMemoryStore.users.find((u) => u.id === r.reviewed_by);
        return {
          ...r,
          streamer_username: r.streamer_username || (streamer ? streamer.username : 'streamer'),
          reviewer_username: reviewer ? reviewer.username : null
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  static async updateStatus(id, { status, review_notes, reviewed_by }) {
    const reviewedAt = new Date().toISOString();

    if (db.isAvailable()) {
      try {
        const query = `
          UPDATE streamer_rewards
          SET status = $1, review_notes = $2, reviewed_by = $3, reviewed_at = NOW()
          WHERE id = $4
          RETURNING *
        `;
        const { rows } = await db.query(query, [status, review_notes, reviewed_by, id]);
        if (rows[0]) return rows[0];
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerRewardModel.updateStatus');
      }
    }

    const reward = InMemoryStore.streamerRewards.find((r) => r.id === id);
    if (!reward) return null;

    reward.status = status;
    reward.review_notes = review_notes;
    reward.reviewed_by = reviewed_by;
    reward.reviewed_at = reviewedAt;

    return reward;
  }

  static async decrementStock(id, amount = 1) {
    if (db.isAvailable()) {
      try {
        const query = `
          UPDATE streamer_rewards
          SET stock = stock - $1
          WHERE id = $2 AND stock >= $1
          RETURNING *
        `;
        const { rows } = await db.query(query, [amount, id]);
        if (rows[0]) return rows[0];
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerRewardModel.decrementStock');
      }
    }

    const reward = InMemoryStore.streamerRewards.find((r) => r.id === id);
    if (!reward) throw new Error('REWARD_NOT_FOUND');
    if (reward.stock < amount) throw new Error('OUT_OF_STOCK');

    reward.stock -= amount;
    return reward;
  }

  static async createRedemption({
    reward_id,
    reward_title,
    streamer_id,
    user_id,
    username,
    coins_spent,
    delivery_type,
    recipient_name,
    shipping_address,
    digital_code
  }) {
    if (db.isAvailable()) {
      try {
        const initialStatus = delivery_type === 'digital' ? 'completed' : 'pending_fulfillment';
        const query = `
          INSERT INTO reward_redemptions (
            reward_id, streamer_id, user_id, coins_spent, delivery_type,
            recipient_name, shipping_address, digital_code, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *
        `;
        const values = [
          reward_id,
          streamer_id,
          user_id,
          coins_spent,
          delivery_type,
          recipient_name || null,
          shipping_address || null,
          digital_code || null,
          initialStatus
        ];
        const { rows } = await db.query(query, values);
        if (rows[0]) {
          console.log(
            `[StreamerRewardModel.createRedemption] DB: Resgate gravado com sucesso (ID: ${rows[0].id}, status: ${rows[0].status})`
          );
          return rows[0];
        }
      } catch (err) {
        console.error(
          '[StreamerRewardModel.createRedemption] Erro no PostgreSQL ao registrar resgate:',
          err.message
        );
        throw err;
      }
    }

    const newRedemption = {
      id: randomUUID(),
      reward_id,
      reward_title,
      streamer_id,
      user_id,
      username: username || 'viewer',
      coins_spent,
      delivery_type,
      recipient_name: recipient_name || null,
      shipping_address: shipping_address || null,
      digital_code: digital_code || null,
      status: delivery_type === 'digital' ? 'completed' : 'pending_fulfillment',
      tracking_code: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    InMemoryStore.rewardRedemptions.unshift(newRedemption);
    return newRedemption;
  }

  static async findRedemptionsByUser(userId) {
    if (db.isAvailable()) {
      try {
        const query = `
          SELECT red.*, rew.title AS reward_title, rew.image_url, u.username AS streamer_username
          FROM reward_redemptions red
          JOIN streamer_rewards rew ON red.reward_id = rew.id
          JOIN users u ON red.streamer_id = u.id
          WHERE red.user_id = $1
          ORDER BY red.created_at DESC
        `;
        const { rows } = await db.query(query, [userId]);
        if (rows) return rows;
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerRewardModel.findRedemptionsByUser');
      }
    }

    return InMemoryStore.rewardRedemptions
      .filter((r) => r.user_id === userId)
      .map((r) => {
        const reward = InMemoryStore.streamerRewards.find((rw) => rw.id === r.reward_id);
        const streamer = InMemoryStore.users.find((u) => u.id === r.streamer_id);
        return {
          ...r,
          reward_title: r.reward_title || (reward ? reward.title : 'Recompensa'),
          image_url: reward ? reward.image_url : '',
          streamer_username: streamer ? streamer.username : 'streamer'
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  static async findRedemptionsByStreamer(streamerId) {
    if (db.isAvailable()) {
      try {
        const query = `
          SELECT red.*, rew.title AS reward_title, rew.image_url, u.username AS viewer_username, u.email AS viewer_email
          FROM reward_redemptions red
          JOIN streamer_rewards rew ON red.reward_id = rew.id
          JOIN users u ON red.user_id = u.id
          WHERE red.streamer_id = $1
          ORDER BY red.created_at DESC
        `;
        const { rows } = await db.query(query, [streamerId]);
        if (rows) return rows;
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerRewardModel.findRedemptionsByStreamer');
      }
    }

    return InMemoryStore.rewardRedemptions
      .filter((r) => r.streamer_id === streamerId)
      .map((r) => {
        const reward = InMemoryStore.streamerRewards.find((rw) => rw.id === r.reward_id);
        const user = InMemoryStore.users.find((u) => u.id === r.user_id);
        return {
          ...r,
          reward_title: r.reward_title || (reward ? reward.title : 'Recompensa'),
          image_url: reward ? reward.image_url : '',
          viewer_username: user ? user.username : r.username || 'viewer',
          viewer_email: user ? user.email : 'espectador@livexgames.dev'
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  static async findRedemptionById(redemptionId) {
    if (db.isAvailable()) {
      try {
        const query = `SELECT * FROM reward_redemptions WHERE id = $1`;
        const { rows } = await db.query(query, [redemptionId]);
        if (rows[0]) return rows[0];
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerRewardModel.findRedemptionById');
      }
    }

    return InMemoryStore.rewardRedemptions.find((r) => r.id === redemptionId) || null;
  }

  static async updateRedemptionStatus(redemptionId, { status, tracking_code }) {
    if (db.isAvailable()) {
      try {
        const query = `
          UPDATE reward_redemptions
          SET status = $1, tracking_code = $2, updated_at = NOW()
          WHERE id = $3
          RETURNING *
        `;
        const { rows } = await db.query(query, [status, tracking_code, redemptionId]);
        if (rows[0]) return rows[0];
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerRewardModel.updateRedemptionStatus');
      }
    }

    const redemption = InMemoryStore.rewardRedemptions.find((r) => r.id === redemptionId);
    if (!redemption) return null;

    redemption.status = status;
    if (tracking_code !== undefined) redemption.tracking_code = tracking_code;
    redemption.updated_at = new Date().toISOString();

    return redemption;
  }
}

module.exports = StreamerRewardModel;
