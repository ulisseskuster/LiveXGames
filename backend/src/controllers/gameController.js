const GameModel = require('../models/gameModel');
const { ok, fail } = require('../utils/response');

class GameController {
  static async history(req, res) {
    try {
      // Direto no LIMIT do SQL: "abc" virava 500 e sem teto a lista vinha inteira.
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
      const history = await GameModel.getUserFlightHistory(req.user.id, limit);
      return ok(res, history, 'Histórico de voos recuperado com sucesso');
    } catch (error) {
      return fail(res, 500, 'Erro ao buscar histórico de voos', error.message);
    }
  }
}

module.exports = GameController;
