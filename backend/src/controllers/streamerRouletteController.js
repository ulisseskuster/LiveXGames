const StreamerRouletteService = require('../services/streamerRouletteService');
const { ok, fail } = require('../utils/response');

class StreamerRouletteController {
  static async getStatus(req, res) {
    try {
      const { streamerId } = req.params;
      const status = await StreamerRouletteService.getStatus(req.user.id, streamerId);
      return ok(res, status, 'Status da roleta diária carregado com sucesso');
    } catch (error) {
      return fail(res, 500, 'Erro ao consultar status da roleta', error.message);
    }
  }

  static async spin(req, res) {
    try {
      const { streamerId } = req.params;
      const io = req.app.get('io');
      const result = await StreamerRouletteService.spin(req.user.id, streamerId, io);
      return ok(res, result, result.message);
    } catch (error) {
      if (error.message.startsWith('ALREADY_SPUN_TODAY')) {
        return fail(
          res,
          409,
          'Você já girou a roleta desse streamer hoje. Volte amanhã!',
          error.message
        );
      }
      if (error.message.startsWith('STREAMER_NOT_FOUND')) {
        return fail(res, 404, 'Streamer não encontrado', error.message);
      }
      if (error.message === 'USER_NOT_FOUND') {
        return fail(res, 404, 'Usuário não encontrado', error.message);
      }
      return fail(res, 500, 'Erro ao girar a roleta diária', error.message);
    }
  }
}

module.exports = StreamerRouletteController;
