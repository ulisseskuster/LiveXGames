// Suíte do InMemoryStore (IDs fictícios, fixtures direto na memória): roda
// sem banco mesmo quando o ambiente define DATABASE_URL, como no CI. Antes ela
// só passava ali porque gravava antes de o pool conectar.
process.env.DATABASE_URL = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const ShopService = require('../src/services/shopService');
const ShopModel = require('../src/models/shopModel');
const WalletModel = require('../src/models/streamerWalletModel');
const CHANNEL = '33333333-3333-3333-3333-333333333333';

test('ShopService: listItems deve retornar catálogo com itens de jato', async () => {
  const items = await ShopService.listItems();

  assert.ok(Array.isArray(items));
  assert.ok(items.length >= 4, 'Catálogo deve ter ao menos 4 itens');

  const nitro = items.find((i) => i.id === 'nitro_booster');
  const shield = items.find((i) => i.id === 'shield_deflector');
  const fuel = items.find((i) => i.id === 'extra_fuel');

  assert.ok(nitro, 'Nitro Booster deve existir');
  assert.ok(shield, 'Escudo Defletor deve existir');
  assert.ok(fuel, 'Tanque Extra deve existir');
});

test('ShopService: purchase deve debitar saldo da carteira e adicionar ao inventário', async () => {
  const testUserId = '11111111-1111-1111-1111-111111111111';

  // Assegura saldo de teste
  await WalletModel.addBalance(testUserId, CHANNEL, 1000);
  const initialWallet = await WalletModel.findByUserAndStreamer(testUserId, CHANNEL);
  const initialBalance = Number(initialWallet.balance);

  const purchaseResult = await ShopService.purchase(testUserId, 'nitro_booster', 1, CHANNEL);

  assert.equal(purchaseResult.success, true);
  const nitroItem = await ShopModel.findItemById('nitro_booster');
  assert.equal(purchaseResult.balance, initialBalance - Number(nitroItem.price));

  const inventory = await ShopService.getUserInventory(testUserId, CHANNEL);
  const nitroInv = inventory.find((i) => i.item_id === 'nitro_booster');
  assert.ok(nitroInv && nitroInv.quantity > 0, 'Item deve estar no inventário');
});

test('ShopService: purchase com saldo insuficiente deve falhar', async () => {
  const brokeUserId = 'user-sem-moedas';
  await WalletModel.addBalance(brokeUserId, CHANNEL, 10); // Apenas 10 moedas

  await assert.rejects(
    async () => {
      await ShopService.purchase(brokeUserId, 'nitro_booster', 1, CHANNEL); // Custa 50
    },
    { message: 'INSUFFICIENT_BALANCE' }
  );
});

test('catálogo: exatamente três itens por jogo; excedentes não podem ser comprados', async () => {
  const { ITENS_POR_JOGO } = require('../src/services/gameCatalog');
  const items = await ShopService.listItems();
  for (const [gameId, ids] of Object.entries(ITENS_POR_JOGO)) {
    assert.deepEqual(
      items
        .filter((i) => i.gameId === gameId)
        .map((i) => i.id)
        .sort(),
      [...ids].sort()
    );
  }
  for (const id of ['flare_chaff', 'emp_missile', 'vip_hangar', 'neon_garage', 'cosmo_skin']) {
    assert.equal(await ShopModel.findItemById(id), null);
    await assert.rejects(
      ShopService.purchase('11111111-1111-1111-1111-111111111111', id, 1, CHANNEL),
      /ITEM_NOT_FOUND/
    );
  }
});
