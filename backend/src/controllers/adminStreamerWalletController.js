const StreamerWalletService = require('../services/streamerWalletService');
const { ok, fail } = require('../utils/response');

class AdminStreamerWalletController {
  static async grant(req, res) {
    try {
      const { userId, streamerId, amount } = req.body;
      if (!userId || !streamerId || !amount) {
        return fail(res, 400, 'userId, streamerId e amount são obrigatórios');
      }

      const result = await StreamerWalletService.adminGrant(
        userId,
        streamerId,
        amount,
        req.user.id
      );
      return ok(res, result, 'Fichas concedidas com sucesso');
    } catch (error) {
      if (error.message.startsWith('INVALID_AMOUNT')) {
        return fail(res, 400, error.message.split(':').slice(1).join(':').trim() || error.message);
      }
      return fail(res, 500, 'Erro ao conceder fichas', error.message);
    }
  }
}

module.exports = AdminStreamerWalletController;
