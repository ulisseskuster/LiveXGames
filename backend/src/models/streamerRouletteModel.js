const { randomUUID } = require('crypto');
const db = require('../config/database');
const InMemoryStore = require('../data/store');

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

class StreamerRouletteModel {
  static async findTodaySpin(userId, streamerId) {
    const today = todayDateString();

    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `SELECT * FROM streamer_roulette_spins WHERE user_id = $1 AND streamer_id = $2 AND spin_date = $3`,
          [userId, streamerId, today]
        );
        if (rows[0]) return rows[0];
        if (rows) return null;
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerRouletteModel.findTodaySpin');
      }
    }

    return (
      InMemoryStore.streamerRouletteSpins.find(
        (s) => s.user_id === userId && s.streamer_id === streamerId && s.spin_date === today
      ) || null
    );
  }

  static async recordSpin({ userId, streamerId, prizeType, prizeAmount, itemId = null }) {
    const today = todayDateString();

    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `INSERT INTO streamer_roulette_spins (user_id, streamer_id, spin_date, prize_type, prize_amount, item_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [userId, streamerId, today, prizeType, prizeAmount, itemId]
        );
        if (rows[0]) return rows[0];
      } catch (err) {
        if (err.code === '23505') {
          throw new Error('ALREADY_SPUN_TODAY', { cause: err });
        }
        try {
          const { rows } = await db.query(
            `INSERT INTO streamer_roulette_spins (user_id, streamer_id, spin_date, prize_type, prize_amount)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [userId, streamerId, today, prizeType, prizeAmount]
          );
          if (rows[0]) return rows[0];
        } catch (retryErr) {
          if (retryErr.code === '23505') {
            throw new Error('ALREADY_SPUN_TODAY', { cause: retryErr });
          }
        }
        db.fallbackOrThrow(err, 'StreamerRouletteModel.recordSpin');
      }
    }

    const existing = InMemoryStore.streamerRouletteSpins.find(
      (s) => s.user_id === userId && s.streamer_id === streamerId && s.spin_date === today
    );
    if (existing) {
      throw new Error('ALREADY_SPUN_TODAY');
    }

    const spin = {
      id: randomUUID(),
      user_id: userId,
      streamer_id: streamerId,
      spin_date: today,
      prize_type: prizeType,
      prize_amount: prizeAmount,
      item_id: itemId,
      created_at: new Date().toISOString()
    };
    InMemoryStore.streamerRouletteSpins.push(spin);
    return spin;
  }
}

module.exports = StreamerRouletteModel;
