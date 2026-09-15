const StreamerRewardService = require('../services/streamerRewardService');

class AdminRewardController {
  static async getModerationQueue(req, res, next) {
    try {
      const { status } = req.query; // 'pending', 'approved', 'rejected', 'all'
      const items = await StreamerRewardService.getModerationQueue(status);
      return res.json({
        success: true,
        data: items
      });
    } catch (err) {
      next(err);
    }
  }

  static async moderateReward(req, res, next) {
    try {
      const { rewardId } = req.params;
      const { action, notes } = req.body; // action: 'approve' | 'reject'
      const adminId = req.user.id;
      const adminUsername = req.user.username;
      const io = req.app.get('io');

      const result = await StreamerRewardService.moderateReward(rewardId, {
        action,
        notes,
        adminId,
        adminUsername,
        io
      });

      return res.json(result);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }
  }
}

module.exports = AdminRewardController;
