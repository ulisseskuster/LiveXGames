// Dashboard do streamer: métricas agregadas do canal.
// Consolida dados de jogo, doações e economia num único endpoint.
// Aproveita as tabelas que já existem (game_runs, channel_wallet_transactions,
// donations, streamer_roulette_spins) sem tabelas novas.

const { pool } = require('../config/database');

const StreamerDashboardService = {
  /**
   * Métricas principais do canal (7/30 dias).
   */
  async getStats(streamerId, days = 7) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const result = await pool.query(
      `
      SELECT
        -- Jogos
        (SELECT COUNT(*)::int FROM game_runs gr
          WHERE gr.streamer_id = $1 AND gr.created_at >= $2) AS rounds_7d,
        (SELECT COUNT(*)::int FROM game_runs gr
          WHERE gr.streamer_id = $1 AND gr.created_at >= now() - interval '30 days') AS rounds_30d,
        (SELECT COUNT(DISTINCT gr.user_id)::int FROM game_runs gr
          WHERE gr.streamer_id = $1 AND gr.created_at >= $2) AS players_7d,
        (SELECT COUNT(DISTINCT gr.user_id)::int FROM game_runs gr
          WHERE gr.streamer_id = $1 AND gr.created_at >= now() - interval '30 days') AS players_30d,

        -- Doações
        (SELECT COUNT(*)::int FROM donations d
          WHERE d.streamer_id = $1 AND d.created_at >= $2 AND d.status = 'completed') AS donations_7d,
        (SELECT COALESCE(SUM(d.amount_cents), 0)::bigint FROM donations d
          WHERE d.streamer_id = $1 AND d.created_at >= $2 AND d.status = 'completed') AS amount_7d_cents,
        (SELECT COALESCE(SUM(d.amount_cents), 0)::bigint FROM donations d
          WHERE d.streamer_id = $1 AND d.created_at >= now() - interval '30 days' AND d.status = 'completed') AS amount_30d_cents,

        -- Resgates
        (SELECT COUNT(*)::int FROM reward_redemptions rr
          WHERE rr.streamer_id = $1 AND rr.created_at >= $2) AS redeems_7d,
        (SELECT COUNT(*)::int FROM reward_redemptions rr
          WHERE rr.streamer_id = $1 AND rr.created_at >= now() - interval '30 days') AS redeems_30d,

        -- Roleta
        (SELECT COUNT(*)::int FROM streamer_roulette_spins srs
          WHERE srs.streamer_id = $1 AND srs.created_at >= $2) AS spins_7d,

        -- Moedas em circulação
        (SELECT COALESCE(SUM(balance), 0)::bigint FROM channel_wallets WHERE streamer_id = $1) AS circulating_coins
    `,
      [streamerId, since]
    );

    const r = result.rows[0];
    return {
      period: { days },
      rounds: { last7: r.rounds_7d, last30: r.rounds_30d },
      players: { last7: r.players_7d, last30: r.players_30d },
      donations: {
        count7: r.donations_7d,
        amount7: r.amount_7d_cents,
        amount30: r.amount_30d_cents
      },
      redeems: { last7: r.redeems_7d, last30: r.redeems_30d },
      rouletteSpins7: r.spins_7d,
      circulatingCoins: r.circulating_coins
    };
  },

  /**
   * Série diária para gráficos (últimos N dias).
   * Retorna linhas com data, rodadas, doações e valor.
   */
  async dailySeries(streamerId, days = 14) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const result = await pool.query(
      `
      WITH dias AS (
        SELECT generate_series(
          date_trunc('day', $2::timestamp),
          date_trunc('day', now()),
          interval '1 day'
        )::date AS dia
      )
      SELECT
        d.dia,
        (SELECT COUNT(*)::int FROM game_runs gr
          WHERE gr.streamer_id = $1 AND gr.created_at::date = d.dia) AS rounds,
        (SELECT COUNT(*)::int FROM donations d2
          WHERE d2.streamer_id = $1 AND d2.created_at::date = d.dia
            AND d2.status = 'completed') AS donations,
        (SELECT COALESCE(SUM(d2.amount_cents), 0)::bigint FROM donations d2
          WHERE d2.streamer_id = $1 AND d2.created_at::date = d.dia
            AND d2.status = 'completed') AS amount_cents
      FROM dias d
      ORDER BY d.dia
    `,
      [streamerId, since]
    );

    return result.rows.map((r) => ({
      date: r.dia,
      rounds: r.rounds,
      donations: r.donations,
      amountCents: r.amount_cents
    }));
  },

  /**
   * Top 5 itens mais usados no canal (consumíveis equipados).
   */
  async topItems(streamerId, limit = 5) {
    const result = await pool.query(
      `
      SELECT
        i.value AS item_id,
        COUNT(*)::int AS uses
      FROM game_runs gr,
        LATERAL jsonb_array_elements_text(gr.result->'itemsUsed') AS i(value)
      WHERE gr.streamer_id = $1
      GROUP BY i.value
      ORDER BY uses DESC
      LIMIT $2
    `,
      [streamerId, limit]
    );

    return result.rows;
  },

  /**
   * Ranking interno do canal: jogadores por rodadas (7 dias).
   */
  async topPlayers(streamerId, days = 7, limit = 10) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = await pool.query(
      `
      SELECT
        u.id, u.username,
        COUNT(gr.id)::int AS rounds,
        COALESCE(MAX((gr.result->>'score')::numeric), 0)::int AS best_score
      FROM game_runs gr
      JOIN users u ON u.id = gr.user_id
      WHERE gr.streamer_id = $1 AND gr.created_at >= $2
      GROUP BY u.id, u.username
      ORDER BY rounds DESC
      LIMIT $3
    `,
      [streamerId, since, limit]
    );
    return result.rows;
  }
};

module.exports = StreamerDashboardService;
