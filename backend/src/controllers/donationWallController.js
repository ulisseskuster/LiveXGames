const DonationWallService = require('../services/donationWallService');
const { ok, fail } = require('../utils/response');

class DonationWallController {
  static async getWall(req, res) {
    try {
      const { streamerId } = req.params;
      const { sort, period, limit, offset } = req.query;

      // optionalAuth: visitante deslogado vê o mural, só não reage. Sem req.user
      // o myReaction de todo card volta null, que é a verdade para quem não tem
      // identidade.
      const resultado = await DonationWallService.listWall(streamerId, {
        sort,
        period,
        limit,
        offset,
        viewerId: req.user ? req.user.id : null
      });

      return ok(
        res,
        {
          ...resultado,
          page:
            Math.floor(
              DonationWallService.sanitizeOffset(offset) / DonationWallService.sanitizeLimit(limit)
            ) + 1
        },
        'Mural de doações carregado com sucesso'
      );
    } catch (error) {
      if (error.message === 'WALL_DISABLED') {
        return fail(res, 403, 'O mural de doações deste canal está desativado', error.message);
      }
      if (error.message === 'STREAMER_NOT_FOUND') {
        return fail(res, 404, 'Streamer não encontrado', error.message);
      }
      return fail(res, 500, 'Erro ao carregar o mural de doações', error.message);
    }
  }

  static async getTopDonors(req, res) {
    try {
      const { period, limit } = req.query;
      const doadores = await DonationWallService.topDonors(req.params.streamerId, {
        period,
        limit
      });
      return ok(res, doadores, 'Maiores doadores carregados com sucesso');
    } catch (error) {
      if (error.message === 'WALL_DISABLED') {
        return fail(res, 403, 'O mural de doações deste canal está desativado', error.message);
      }
      if (error.message === 'STREAMER_NOT_FOUND') {
        return fail(res, 404, 'Streamer não encontrado', error.message);
      }
      return fail(res, 500, 'Erro ao carregar os maiores doadores', error.message);
    }
  }

  static async react(req, res) {
    try {
      const { streamerId, donationId } = req.params;
      const io = req.app.get('io');

      const resultado = await DonationWallService.react(
        { streamerId, donationId, userId: req.user.id, type: req.body.type },
        io
      );

      return ok(res, resultado, 'Reação registrada com sucesso');
    } catch (error) {
      if (error.message === 'INVALID_REACTION_TYPE') {
        return fail(res, 400, 'Reação inválida: use "like" ou "dislike"', error.message);
      }
      if (error.message === 'CANNOT_REACT_OWN_DONATION') {
        return fail(res, 403, 'Você não pode reagir à sua própria doação', error.message);
      }
      if (error.message === 'WALL_DISABLED') {
        return fail(res, 403, 'O mural de doações deste canal está desativado', error.message);
      }
      if (error.message === 'DONATION_NOT_FOUND') {
        return fail(res, 404, 'Doação não encontrada neste mural', error.message);
      }
      return fail(res, 500, 'Erro ao registrar a reação', error.message);
    }
  }

  static async remove(req, res) {
    try {
      const { streamerId, donationId } = req.params;
      const io = req.app.get('io');

      const resultado = await DonationWallService.hideFromWall(
        { streamerId, donationId, requester: req.user },
        io
      );

      return ok(res, resultado, 'Mensagem removida do mural');
    } catch (error) {
      if (error.message === 'NOT_CHANNEL_OWNER') {
        return fail(
          res,
          403,
          'Apenas o dono do canal pode remover mensagens do mural',
          error.message
        );
      }
      if (error.message === 'DONATION_NOT_FOUND') {
        return fail(res, 404, 'Doação não encontrada neste mural', error.message);
      }
      return fail(res, 500, 'Erro ao remover a mensagem do mural', error.message);
    }
  }
}

module.exports = DonationWallController;
