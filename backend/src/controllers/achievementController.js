// Controller de conquistas: listagem, desbloqueio, ranking.

const AchievementService = require('../services/achievementService');

const AchievementController = {
  /**
   * GET /api/achievements/me
   * Lista todas as conquistas com status de desbloqueio do usuário logado.
   */
  async me(req, res, next) {
    try {
      const all = await AchievementService.getAllForUser(req.user.id);
      const unlockedCount = all.filter((a) => a.unlocked_at).length;
      res.json({
        success: true,
        total: all.length,
        unlocked: unlockedCount,
        achievements: all
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/achievements/user/:userId
   * Lista conquistas desbloqueadas de qualquer usuário (público, para perfil).
   */
  async userPublic(req, res, next) {
    try {
      const unlocked = await AchievementService.getUnlocked(req.params.userId);
      res.json({ success: true, achievements: unlocked });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/achievements/check
   * Recalcula conquistas do usuário atual (chamado após ações relevantes).
   */
  async check(req, res, next) {
    try {
      const newlyUnlocked = await AchievementService.checkAndUnlock(req.user.id);
      const total = await AchievementService.countUnlocked(req.user.id);
      res.json({ success: true, newlyUnlocked, total });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/achievements/streamer/:streamerId/ranking
   * Ranking de jogadores por conquistas no canal (para o streamer).
   */
  async streamerRanking(req, res, next) {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
      const ranking = await AchievementService.streamerRanking(req.params.streamerId, limit);
      res.json({ success: true, ranking });
    } catch (err) {
      next(err);
    }
  }
};

module.exports = AchievementController;
