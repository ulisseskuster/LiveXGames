const StreamerRewardService = require('../services/streamerRewardService');

class StreamerRewardController {
  static async createReward(req, res, next) {
    try {
      const { title, description, price_coins, stock, image_url, delivery_type } = req.body;
      const streamer_id = req.user.id;
      const streamer_username = req.user.username;

      const result = await StreamerRewardService.createReward({
        streamer_id,
        streamer_username,
        title,
        description,
        price_coins,
        stock,
        image_url,
        delivery_type
      });

      return res.status(201).json(result);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }
  }

  static async getPublicCatalog(req, res, next) {
    try {
      const { streamerId, type, delivery_type } = req.query;
      const deliveryType = type || delivery_type || null;
      const rewards = await StreamerRewardService.getApprovedCatalog(streamerId, deliveryType);
      return res.json({
        success: true,
        data: rewards
      });
    } catch (err) {
      next(err);
    }
  }

  static async getMyRewards(req, res, next) {
    try {
      const streamerId = req.user.id;
      const rewards = await StreamerRewardService.getStreamerRewards(streamerId);
      return res.json({
        success: true,
        data: rewards
      });
    } catch (err) {
      next(err);
    }
  }

  static async redeem(req, res, next) {
    try {
      const { rewardId, recipient_name, shipping_address } = req.body;
      const userId = req.user.id;
      const io = req.app.get('io');

      const result = await StreamerRewardService.redeemReward({
        rewardId,
        userId,
        recipient_name,
        shipping_address,
        io
      });

      return res.status(200).json(result);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }
  }

  static async getMyRedemptions(req, res, next) {
    try {
      const userId = req.user.id;
      const redemptions = await StreamerRewardService.getUserRedemptions(userId);
      return res.json({
        success: true,
        data: redemptions
      });
    } catch (err) {
      next(err);
    }
  }

  static async getMyOrders(req, res, next) {
    try {
      const streamerId = req.user.id;
      const orders = await StreamerRewardService.getStreamerOrders(streamerId);
      return res.json({
        success: true,
        data: orders
      });
    } catch (err) {
      next(err);
    }
  }

  static async updateOrderStatus(req, res, next) {
    try {
      const { redemptionId } = req.params;
      const { status, tracking_code } = req.body;

      const result = await StreamerRewardService.fulfillOrder(redemptionId, {
        status,
        tracking_code,
        requesterId: req.user.id,
        requesterRole: req.user.role
      });

      return res.json(result);
    } catch (err) {
      const statusCode = err.message.startsWith('FORBIDDEN') ? 403 : 400;
      return res.status(statusCode).json({
        success: false,
        message: err.message
      });
    }
  }
}

module.exports = StreamerRewardController;
