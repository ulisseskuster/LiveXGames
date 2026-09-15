const ShopService = require('../services/shopService');
const { ok, fail } = require('../utils/response');

class ShopController {
  static async listItems(req, res) {
    try {
      const items = await ShopService.listItems();
      return ok(res, items, 'Itens da loja carregados com sucesso');
    } catch (error) {
      if (error.message === 'INVALID_STREAMER')
        return fail(res, 400, 'Selecione um canal de streamer válido');
      return fail(res, 500, 'Erro ao listar itens da loja', error.message);
    }
  }

  static async getWallet(req, res) {
    try {
      const userId = req.params.userId || req.user.id;

      // Evita IDOR: apenas o dono da carteira ou um admin pode consultá-la
      if (userId !== req.user.id && req.user.role !== 'admin') {
        return fail(res, 403, 'Acesso negado: você só pode consultar sua própria carteira');
      }

      const wallet = await ShopService.getWallet(userId, req.query.streamerId);
      return ok(res, wallet, 'Carteira consultada com sucesso');
    } catch (error) {
      if (error.message === 'INVALID_STREAMER')
        return fail(res, 400, 'Selecione um canal de streamer válido');
      if (error.message === 'WALLET_NOT_FOUND') {
        return fail(res, 404, 'Carteira não encontrada');
      }
      return fail(res, 500, 'Erro ao consultar carteira', error.message);
    }
  }

  static async getInventory(req, res) {
    try {
      const userId = req.user ? req.user.id : req.params.userId;
      if (!userId) {
        return fail(res, 400, 'userId é obrigatório');
      }

      const inventory = await ShopService.getUserInventory(userId, req.query.streamerId);
      return ok(res, inventory, 'Inventário consultado com sucesso');
    } catch (error) {
      if (error.message === 'INVALID_STREAMER')
        return fail(res, 400, 'Selecione um canal de streamer válido');
      return fail(res, 500, 'Erro ao consultar inventário', error.message);
    }
  }

  static async purchaseItem(req, res) {
    try {
      const userId = req.user ? req.user.id : req.body.userId;
      const { itemId, quantity = 1 } = req.body;

      if (!userId || !itemId) {
        return fail(res, 400, 'userId e itemId são obrigatórios');
      }

      const qty = quantity;
      if (!Number.isSafeInteger(qty) || qty < 1 || qty > 100) {
        return fail(res, 400, 'quantity deve ser um número inteiro positivo');
      }

      const result = await ShopService.purchase(userId, itemId, qty, req.body.streamerId);

      // Emite evento via socket se io estiver no app
      const io = req.app.get('io');
      if (io) {
        io.emit('shop:item-purchased', {
          userId,
          username: req.user ? req.user.username : 'espectador',
          itemId,
          itemName: result.itemName,
          quantity: qty,
          timestamp: new Date().toISOString()
        });
      }

      return ok(res, result, 'Compra realizada com sucesso');
    } catch (error) {
      if (error.message === 'INVALID_STREAMER')
        return fail(res, 400, 'Selecione um canal de streamer válido');
      if (error.message === 'ITEM_NOT_FOUND') {
        return fail(res, 404, 'Item não encontrado');
      }
      if (error.message === 'WALLET_NOT_FOUND') {
        return fail(res, 404, 'Carteira não encontrada');
      }
      if (error.message === 'INSUFFICIENT_BALANCE') {
        return fail(res, 400, 'Saldo insuficiente para realizar a compra');
      }
      if (error.message === 'INVALID_INPUT' || error.message === 'INVALID_QUANTITY') {
        return fail(res, 400, 'Dados inválidos para compra');
      }
      return fail(res, 500, 'Erro ao processar compra de item', error.message);
    }
  }
}

module.exports = ShopController;
