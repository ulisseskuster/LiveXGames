// Dashboard do streamer — controller

const StreamerDashboardService = require('../services/streamerDashboardService');

const StreamerDashboardController = {
  /**
   * GET /api/streamer/dashboard/stats?days=7
   * Métricas principais do canal do streamer logado.
   */
  async stats(req, res, next) {
    try {
      const streamerId = req.user.id;
      const days = Math.min(parseInt(req.query.days, 10) || 7, 90);
      const stats = await StreamerDashboardService.getStats(streamerId, days);
      res.json({ success: true, stats });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/streamer/dashboard/series?days=14
   * Série diária para gráficos.
   */
  async series(req, res, next) {
    try {
      const streamerId = req.user.id;
      const days = Math.min(parseInt(req.query.days, 10) || 14, 90);
      const series = await StreamerDashboardService.dailySeries(streamerId, days);
      res.json({ success: true, series });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/streamer/dashboard/top-items
   * Itens mais usados no canal.
   */
  async topItems(req, res, next) {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 5, 20);
      const items = await StreamerDashboardService.topItems(req.user.id, limit);
      res.json({ success: true, items });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/streamer/dashboard/top-players?days=7
   * Jogadores mais ativos do canal.
   */
  async topPlayers(req, res, next) {
    try {
      const days = Math.min(parseInt(req.query.days, 10) || 7, 90);
      const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
      const players = await StreamerDashboardService.topPlayers(req.user.id, days, limit);
      res.json({ success: true, players });
    } catch (err) {
      next(err);
    }
  }
};

module.exports = StreamerDashboardController;
