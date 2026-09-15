const LeaderboardService = require('../services/leaderboardService');
const { jogoPorId } = require('../services/sim/games');
const { ok, fail } = require('../utils/response');

class LeaderboardController {
  static async get(req, res) {
    try {
      const { periodo } = req.params;
      if (!Object.hasOwn(LeaderboardService.PERIODOS, periodo)) {
        return fail(res, 404, 'Período de ranking inválido');
      }
      const limit = req.query.limit || 10;
      // Cada jogo tem a própria escala (pontos = 2 × distância, e a distância de
      // referência vai de 1000 a 2800 m): num ranking único o Jet ganharia sempre.
      const { gameId } = req.query;
      if (
        gameId !== undefined &&
        !(typeof gameId === 'string' && jogoPorId(gameId)?.entraNoRanking)
      ) {
        return fail(res, 400, 'Jogo inválido para o ranking');
      }
      const leaderboard = await LeaderboardService.getLeaderboard(limit, gameId, periodo);
      return ok(res, leaderboard, 'Ranking carregado com sucesso');
    } catch (error) {
      return fail(res, 500, 'Erro ao carregar ranking', error.message);
    }
  }

  /**
   * GET /api/leaderboard/streamers/:periodo
   * Ranking de streamers por atividade do canal (rodadas + doações).
   */
  static async streamers(req, res) {
    try {
      const { periodo } = req.params;
      if (!Object.hasOwn(LeaderboardService.PERIODOS, periodo)) {
        return fail(res, 404, 'Período de ranking inválido');
      }
      const limit = req.query.limit || 20;
      const ranking = await LeaderboardService.getStreamerRanking(limit, periodo);
      return ok(res, ranking, 'Ranking de streamers carregado com sucesso');
    } catch (error) {
      return fail(res, 500, 'Erro ao carregar ranking de streamers', error.message);
    }
  }
}

module.exports = LeaderboardController;
