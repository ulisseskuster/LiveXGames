// Conquistas: desbloqueio automático, consulta e ranking.
// Verifica condições após cada ação relevante (rodada, doação, resgate, etc.)
// e inser user_achievements se a conquista ainda não foi desbloqueada.

const { pool } = require('../config/database');

const AchievementService = {
  /**
   * Retorna todas as conquistas com status de desbloqueio para um usuário.
   */
  async getAllForUser(userId) {
    const result = await pool.query(
      `
      SELECT
        a.id,
        a.title,
        a.description,
        a.icon,
        a.category,
        a.threshold,
        ua.unlocked_at
      FROM achievements a
      LEFT JOIN user_achievements ua
        ON ua.achievement_id = a.id AND ua.user_id = $1
      ORDER BY a.category, a.threshold
    `,
      [userId]
    );
    return result.rows;
  },

  /**
   * Retorna apenas as conquistas desbloqueadas de um usuário.
   */
  async getUnlocked(userId) {
    const result = await pool.query(
      `
      SELECT
        a.id, a.title, a.description, a.icon, a.category,
        ua.unlocked_at
      FROM user_achievements ua
      JOIN achievements a ON a.id = ua.achievement_id
      WHERE ua.user_id = $1
      ORDER BY ua.unlocked_at DESC
    `,
      [userId]
    );
    return result.rows;
  },

  /**
   * Conta conquistas desbloqueadas de um usuário (para badge/resumo).
   */
  async countUnlocked(userId) {
    const result = await pool.query(
      'SELECT COUNT(*)::int AS total FROM user_achievements WHERE user_id = $1',
      [userId]
    );
    return result.rows[0].total;
  },

  /**
   * Tenta desbloquear uma conquista. Retorna true se era nova.
   * Não faz nada se já desbloqueada (UNIQUE protege contra race condition).
   * Aceita um client opcional: quando chamado de dentro da transação do
   * checkAndUnlock (com advisory lock por usuário), usa o client da transação
   * para o INSERT participar do lock e do COMMIT.
   */
  async unlock(userId, achievementId, client) {
    try {
      const executor = client || pool;
      const result = await executor.query(
        `
        INSERT INTO user_achievements (user_id, achievement_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, achievement_id) DO NOTHING
      `,
        [userId, achievementId]
      );
      return result.rowCount === 1;
    } catch (err) {
      console.warn(
        `[Achievements] Erro ao desbloquear ${achievementId} para ${userId}:`,
        err.message
      );
      return false;
    }
  },

  /**
   * Verifica e desbloqueia conquistas com base em contadores.
   * Chamado pelo backend após eventos relevantes.
   *
   * Roda numa transação com advisory lock por usuário: a liquidação de rodada
   * (liquidarGerada) usa o MESMO lock, e o INSERT em user_achievements aqui
   * cruza locks de linha com a transação dela. Sem o lock, duas operações do
   * mesmo usuário em paralelo (liquidação + conquista) travam linhas em ordens
   * diferentes e o PostgreSQL mata uma com deadlock 40P01.
   */
  async checkAndUnlock(userId) {
    const unlocked = [];

    // ── Contagens do banco ──────────────────────────────────────────────
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);

      const counts = await client.query(
        `
        SELECT
          (SELECT COUNT(*)::int FROM game_runs WHERE user_id = $1) AS total_flights,
          (SELECT COALESCE(MAX((result->>'score')::numeric), 0)::int FROM game_runs WHERE user_id = $1) AS best_score,
          (SELECT COUNT(DISTINCT game_id)::int FROM game_runs WHERE user_id = $1) AS games_played,
          (SELECT COUNT(*)::int FROM donations WHERE user_id = $1) AS total_donations,
          (SELECT COALESCE(MAX(amount_cents), 0)::int FROM donations WHERE user_id = $1) AS biggest_donation,
          (SELECT COUNT(*)::int FROM donation_reactions WHERE user_id = $1) AS total_reactions,
          (SELECT COUNT(*)::int FROM reward_redemptions WHERE user_id = $1) AS total_redeems
      `,
        [userId]
      );
      const c = counts.rows[0];

      // ── Game ────────────────────────────────────────────────────────────
      const gameChecks = [
        { id: 'first_flight', threshold: 1, value: c.total_flights },
        { id: 'flights_10', threshold: 10, value: c.total_flights },
        { id: 'flights_50', threshold: 50, value: c.total_flights },
        { id: 'flights_100', threshold: 100, value: c.total_flights },
        { id: 'high_score_1000', threshold: 1000, value: c.best_score },
        { id: 'high_score_5000', threshold: 5000, value: c.best_score },
        { id: 'high_score_10000', threshold: 10000, value: c.best_score },
        { id: 'play_all_games', threshold: 3, value: c.games_played }
      ];

      // ── Donation ────────────────────────────────────────────────────────
      const donationChecks = [
        { id: 'first_donation', threshold: 1, value: c.total_donations },
        { id: 'donations_5', threshold: 5, value: c.total_donations },
        { id: 'donations_20', threshold: 20, value: c.total_donations },
        { id: 'big_donation', threshold: 5000, value: c.biggest_donation }
      ];

      // ── Social ──────────────────────────────────────────────────────────
      const socialChecks = [
        { id: 'first_reaction', threshold: 1, value: c.total_reactions },
        { id: 'reactions_50', threshold: 50, value: c.total_reactions },
        { id: 'first_redeem', threshold: 1, value: c.total_redeems },
        { id: 'redeems_5', threshold: 5, value: c.total_redeems }
      ];

      const allChecks = [...gameChecks, ...donationChecks, ...socialChecks];

      for (const check of allChecks) {
        if (check.value >= check.threshold) {
          const isNew = await this.unlock(userId, check.id, client);
          if (isNew) unlocked.push(check.id);
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        // ROLLBACK pode falhar se a conexão caiu; o erro original é o que importa.
      }
      console.warn(`[Achievements] Falha ao checar conquistas de ${userId}:`, err.message);
      return [];
    } finally {
      client.release();
    }

    return unlocked;
  },

  /**
   * Ranking de streamers por conquistas dos jogadores do canal.
   * Retorna top streamers cujos jogadores mais conquistaram.
   */
  async streamerRanking(streamerId, limit = 20) {
    const result = await pool.query(
      `
      SELECT
        u.id AS user_id,
        u.username,
        COUNT(DISTINCT ua.id)::int AS achievement_count
      FROM user_achievements ua
      JOIN users u ON u.id = ua.user_id
      JOIN game_runs gr ON gr.user_id = ua.user_id AND gr.streamer_id = $1
      GROUP BY u.id, u.username
      ORDER BY achievement_count DESC
      LIMIT $2
    `,
      [streamerId, limit]
    );
    return result.rows;
  }
};

module.exports = AchievementService;
