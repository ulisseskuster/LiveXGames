const GameModel = require('../models/gameModel');

/**
 * Cache curto por TTL do ranking. A agregação (GROUP BY sobre flight_runs) roda
 * a cada 5s no máximo por chave, em vez de a cada request — no pico de reload
 * (ESCALA.md estima ~300 req/s com 1.500 clientes) isso tira a consulta do
 * caminho quente. `invalidar()` é chamado quando um voo é liquidado, então o
 * ranking nunca fica mais velho que alguns segundos após a última partida.
 */
/** @type {Map<string, {em: number, dados: any[]}>} */
const cache = new Map();

function ttlMs() {
  const v = Number(process.env.LEADERBOARD_TTL_MS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 5000;
}

function chave(limit, gameId, periodo) {
  return `${limit}|${gameId || ''}|${periodo}`;
}

class LeaderboardService {
  /** Janelas móveis em dias, as mesmas do mural de doações (DonationModel.WALL_PERIODS). */
  static PERIODOS = { weekly: 7, monthly: 30, all: null };

  /** Um voo novo saiu: o ranking que pode incluí-lo precisa ser recalculado. */
  static invalidar() {
    cache.clear();
  }

  /**
   * @param {string} [gameId] sem ele, soma os três jogos
   * @param {'weekly'|'monthly'|'all'} [periodo]
   */
  static async getLeaderboard(limit = 10, gameId, periodo = 'weekly') {
    const numLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const k = chave(numLimit, gameId, periodo);
    const agora = Date.now();
    const hit = cache.get(k);
    if (hit && agora - hit.em < ttlMs()) return hit.dados;
    const rows = await GameModel.getLeaderboard(
      numLimit,
      gameId || null,
      LeaderboardService.PERIODOS[periodo]
    );

    // Ranking é público: expõe só o necessário para exibição (o frontend usa
    // username/role/best_score/max_distance/total_flights — ver renderLeaderboard
    // em app.js). user_id (identificador persistente) e last_flight (timestamp de
    // atividade) não são usados pela UI e não precisam ser públicos.
    const dados = rows.map((row) => ({
      username: row.username,
      role: row.role,
      best_score: Number(row.best_score),
      max_distance: Number(row.max_distance),
      total_flights: Number(row.total_flights)
    }));
    cache.set(k, { em: agora, dados });
    return dados;
  }

  /**
   * Ranking mundial de streamers: por total de jogadas recebidas no canal
   * e soma de doações no período. Cross-channel: compara canais entre si.
   */
  static async getStreamerRanking(limit = 20, periodo = 'weekly') {
    const numLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const days = LeaderboardService.PERIODOS[periodo];

    const { pool } = require('../config/database');
    const sinceClause = days ? `AND gr.created_at >= now() - make_interval(days => ${days})` : '';

    const result = await pool.query(
      `
      SELECT
        u.id AS streamer_id,
        u.username,
        (SELECT COUNT(DISTINCT gr.user_id)::int FROM game_runs gr
          WHERE gr.streamer_id = u.id ${sinceClause}) AS players,
        (SELECT COUNT(*)::int FROM game_runs gr
          WHERE gr.streamer_id = u.id ${sinceClause}) AS rounds,
        (SELECT COALESCE(SUM(d.amount_cents), 0)::bigint FROM donations d
          WHERE d.streamer_id = u.id AND d.status = 'completed'
          ${days ? `AND d.created_at >= now() - make_interval(days => ${days})` : ''}) AS donation_cents
      FROM users u
      WHERE u.role IN ('streamer', 'admin')
      ORDER BY rounds DESC, donation_cents DESC
      LIMIT $1
    `,
      [numLimit]
    );

    return result.rows.map((row) => ({
      username: row.username,
      players: Number(row.players),
      rounds: Number(row.rounds),
      donationCents: Number(row.donation_cents)
    }));
  }
}

module.exports = LeaderboardService;
