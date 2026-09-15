const db = require('../config/database');
const InMemoryStore = require('../data/store');

/** flight_runs é gravado junto com a liquidação da rodada (GameRunModel.liquidarGerada). */
class GameModel {
  /** @param {number|null} dias janela móvel; null = desde o início */
  static async getLeaderboard(limit = 10, gameId = null, dias = 7) {
    if (db.isAvailable()) {
      try {
        const query = `
          SELECT
            u.id as user_id,
            u.username,
            u.role,
            MAX(fr.score) as best_score,
            MAX(fr.distance) as max_distance,
            COUNT(fr.id) as total_flights,
            MAX(fr.created_at) as last_flight
          FROM flight_runs fr
          JOIN users u ON fr.user_id = u.id
          WHERE ($3::int IS NULL OR fr.created_at >= NOW() - make_interval(days => $3::int))
            AND ($2::varchar IS NULL OR fr.game_id = $2)
          GROUP BY u.id, u.username, u.role
          ORDER BY best_score DESC
          LIMIT $1
        `;
        const { rows } = await db.query(query, [limit, gameId, dias]);
        // Período sem partidas é ranking vazio. Cair no agregado em memória com o
        // banco no ar mostrava as partidas de demonstração do InMemoryStore.
        return rows;
      } catch (err) {
        db.fallbackOrThrow(err, 'GameModel.getLeaderboard');
      }
    }

    // Agrupamento em memória
    const desde = dias === null ? -Infinity : Date.now() - dias * 24 * 60 * 60 * 1000;
    const userBest = new Map();

    for (const run of InMemoryStore.flightRuns) {
      const runTime = new Date(run.created_at).getTime();
      if (runTime < desde) continue;
      if (gameId && run.game_id !== gameId) continue;

      const user = InMemoryStore.users.find((u) => u.id === run.user_id) || {
        id: run.user_id,
        username: 'Piloto Desconhecido',
        role: 'viewer'
      };

      const existing = userBest.get(run.user_id);
      if (!existing) {
        userBest.set(run.user_id, {
          user_id: user.id,
          username: user.username,
          role: user.role,
          best_score: Number(run.score),
          max_distance: Number(run.distance),
          total_flights: 1,
          last_flight: run.created_at
        });
      } else {
        // Máximos independentes, como MAX(score) e MAX(distance) no SQL.
        existing.total_flights += 1;
        existing.best_score = Math.max(existing.best_score, Number(run.score));
        existing.max_distance = Math.max(existing.max_distance, Number(run.distance));
      }
    }

    const leaderboard = Array.from(userBest.values())
      .sort((a, b) => b.best_score - a.best_score)
      .slice(0, limit);

    return leaderboard;
  }

  static async getUserFlightHistory(userId, limit = 10) {
    if (db.isAvailable()) {
      try {
        const query = `
          SELECT id, game_id, distance, max_altitude, score, coins_earned, items_used, created_at
          FROM flight_runs
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT $2
        `;
        const { rows } = await db.query(query, [userId, limit]);
        if (rows) return rows;
      } catch (err) {
        db.fallbackOrThrow(err, 'GameModel.getUserFlightHistory');
      }
    }

    return InMemoryStore.flightRuns.filter((r) => r.user_id === userId).slice(0, limit);
  }
}

module.exports = GameModel;
