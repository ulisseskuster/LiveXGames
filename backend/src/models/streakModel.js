const db = require('../config/database');
const InMemoryStore = require('../data/store');

/**
 * Streak diário: dias consecutivos com pelo menos uma rodada jogada.
 *
 * A regra de negócio vive numa única UPSERT (PostgreSQL):
 * - Se o último dia de atividade é HOJE, nada muda (já jogou hoje).
 * - Se é ONTEM, a sequência continua (+1) e o recorde sobe junto.
 * - Se é mais antigo que ontem, a sequência recomeça em 1.
 * - Sem atividade anterior, o streak começa em 1.
 *
 * O InMemoryStore não mantém persistência entre processos; o streak é um estado
 * do usuário e, sem banco, o fallback é a melhor aproximação possível dentro
 * da mesma instância (mesma semântica dos demais models de estado).
 */
class StreakModel {
  /**
   * Registra atividade do usuário (uma rodada jogada) na data de hoje.
   * Retorna o estado atualizado do streak.
   */
  static async registrarAtividade(userId) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `INSERT INTO user_streaks (user_id, current_streak, best_streak, last_activity_date)
           VALUES ($1, 1, 1, CURRENT_DATE)
           ON CONFLICT (user_id) DO UPDATE SET
             current_streak = CASE
               WHEN user_streaks.last_activity_date = CURRENT_DATE THEN user_streaks.current_streak
               WHEN user_streaks.last_activity_date = CURRENT_DATE - 1 THEN user_streaks.current_streak + 1
               ELSE 1
             END,
             best_streak = GREATEST(user_streaks.best_streak,
               CASE
                 WHEN user_streaks.last_activity_date = CURRENT_DATE THEN user_streaks.current_streak
                 WHEN user_streaks.last_activity_date = CURRENT_DATE - 1 THEN user_streaks.current_streak + 1
                 ELSE 1
               END),
             last_activity_date = CASE
               WHEN user_streaks.last_activity_date = CURRENT_DATE THEN user_streaks.last_activity_date
               ELSE CURRENT_DATE
             END,
             updated_at = NOW()
           RETURNING current_streak, best_streak, last_activity_date`,
          [userId]
        );
        const r = rows[0];
        return {
          current: r.current_streak,
          best: r.best_streak,
          lastActivityDate: r.last_activity_date
        };
      } catch (err) {
        db.fallbackOrThrow(err, 'StreakModel.registrarAtividade');
      }
    }

    // Fallback em memória: sem banco, o streak vive no processo.
    let streak = InMemoryStore.userStreaks.find((s) => s.user_id === userId);
    const hoje = new Date().toISOString().slice(0, 10);
    const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    if (!streak) {
      streak = {
        user_id: userId,
        current_streak: 1,
        best_streak: 1,
        last_activity_date: hoje,
        updated_at: new Date().toISOString()
      };
      InMemoryStore.userStreaks.push(streak);
    } else {
      if (streak.last_activity_date === hoje) {
        // já jogou hoje: nada muda
      } else if (streak.last_activity_date === ontem) {
        streak.current_streak += 1;
        streak.best_streak = Math.max(streak.best_streak, streak.current_streak);
        streak.last_activity_date = hoje;
      } else {
        streak.current_streak = 1;
        streak.best_streak = Math.max(streak.best_streak, 1);
        streak.last_activity_date = hoje;
      }
      streak.updated_at = new Date().toISOString();
    }

    return {
      current: streak.current_streak,
      best: streak.best_streak,
      lastActivityDate: streak.last_activity_date
    };
  }

  /** Estado atual do streak de um usuário (para exibir no perfil). */
  static async getStreak(userId) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `SELECT current_streak, best_streak, last_activity_date
           FROM user_streaks WHERE user_id = $1`,
          [userId]
        );
        if (!rows[0]) {
          return { current: 0, best: 0, lastActivityDate: null };
        }
        return {
          current: rows[0].current_streak,
          best: rows[0].best_streak,
          lastActivityDate: rows[0].last_activity_date
        };
      } catch (err) {
        db.fallbackOrThrow(err, 'StreakModel.getStreak');
      }
    }
    const streak = InMemoryStore.userStreaks.find((s) => s.user_id === userId);
    if (!streak) return { current: 0, best: 0, lastActivityDate: null };
    return {
      current: streak.current_streak,
      best: streak.best_streak,
      lastActivityDate: streak.last_activity_date
    };
  }
}

module.exports = StreakModel;
