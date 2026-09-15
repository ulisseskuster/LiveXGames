const ShopModel = require('../models/shopModel');
const ChannelInventory = require('../models/channelInventoryModel');
const StreamerWallet = require('./streamerWalletService');
const { requireChannel } = require('./channelScope');
const { comercializavel } = require('./gameCatalog');
const { multiplicadorDoItem } = require('./sim/scoreBonus');
const Economy = require('./economy');

class ShopService {
  static async listItems() {
    const items = await ShopModel.findAllItems();

    // Catálogo é público: nunca expor `flight_bonus` (efeitos internos de jogo,
    // recalculados sempre no servidor em GameRunService) nem `stock` (contador
    // artificial não aplicado em nenhuma regra de negócio real).
    return items.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      description: item.description,
      price: item.price,
      rarity: item.rarity,
      scoreMultiplier: multiplicadorDoItem(item),
      // % da moeda-base da rodada que o item soma; nunca passa do preço (economy.js).
      coinBonusPercent: Math.round(Economy.fracaoDeMoedasDoItem(item) * 100),
      icon: item.icon,
      gameId: item.gameId ?? null
    }));
  }

  static async getWallet(userId, streamerId) {
    return StreamerWallet.getBalance(userId, streamerId);
  }

  static async getUserInventory(userId, streamerId) {
    await requireChannel(streamerId);
    return ChannelInventory.list(userId, streamerId);
  }

  static async purchase(userId, itemId, quantity = 1, streamerId) {
    if (!userId || !itemId) throw new Error('INVALID_INPUT');
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100)
      throw new Error('INVALID_QUANTITY');
    await requireChannel(streamerId);
    if (!comercializavel(itemId)) throw new Error('ITEM_NOT_FOUND');
    const item = await ShopModel.findItemById(itemId);
    if (!item) throw new Error('ITEM_NOT_FOUND');
    return ChannelInventory.purchase(userId, streamerId, item, quantity);
  }
}

module.exports = ShopService;
