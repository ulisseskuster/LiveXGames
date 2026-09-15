const PaymentService = require('../services/paymentService');
const { ok, fail } = require('../utils/response');

class PaymentController {
  static async donate(req, res) {
    try {
      const userId = req.user && req.user.id ? req.user.id : null;
      const { amount, message } = req.body;

      if (!userId) {
        return fail(res, 401, 'Autenticação obrigatória para realizar uma doação');
      }

      if (!amount || Number(amount) <= 0) {
        return fail(res, 400, 'amount válido é obrigatório');
      }

      const result = await PaymentService.createDonationIntent({
        userId,
        amount: Number(amount),
        message
      });

      return ok(res, result, 'Intenção de doação gerada com sucesso');
    } catch (error) {
      if (error.message === 'INVALID_DONATION') {
        return fail(res, 400, 'Payload de doação inválido');
      }
      return fail(res, 500, 'Erro ao processar doação', error.message);
    }
  }

  static async simulate(req, res) {
    try {
      // A restrição de papel (streamer/admin) é aplicada por requireRole na
      // definição da rota, em todos os ambientes. A checagem que existia aqui
      // valia só quando NODE_ENV === 'production' e abria a emissão de moedas
      // a qualquer viewer autenticado nos demais ambientes; abria também uma
      // exceção por username ('testsprite_user', que é um viewer), removida
      // junto por ser uma credencial de contorno permanente.

      // Sempre credita na carteira do próprio usuário autenticado — nunca em um
      // userId arbitrário — e limita o valor simulável para evitar abuso da
      // funcionalidade de demonstração como fonte de moeda infinita.
      const userId = req.user.id;
      const { amount, message, streamerId } = req.body;
      const io = req.app.get('io');
      const MAX_SIMULATED_AMOUNT = 5000;

      if (!amount || Number(amount) <= 0) {
        return fail(res, 400, 'amount válido é obrigatório');
      }

      if (Number(amount) > MAX_SIMULATED_AMOUNT) {
        return fail(res, 400, `Valor simulado não pode exceder R$ ${MAX_SIMULATED_AMOUNT},00`);
      }

      if (!streamerId) {
        return fail(
          res,
          400,
          'streamerId é obrigatório: entre na página de um streamer antes de simular uma doação'
        );
      }

      const result = await PaymentService.simulateDonation(
        {
          userId,
          amount: Number(amount),
          message,
          streamerId
        },
        io
      );

      return ok(res, result, 'Simulação de doação concluída com sucesso');
    } catch (error) {
      return fail(res, 500, 'Erro ao simular doação', error.message);
    }
  }
}

module.exports = PaymentController;
