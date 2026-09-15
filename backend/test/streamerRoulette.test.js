const { test } = require('node:test');
const assert = require('node:assert/strict');
const StreamerRouletteService = require('../src/services/streamerRouletteService');
const ShopModel = require('../src/models/shopModel');

test('StreamerRouletteService: getWheelSegments deve retornar exatamente 8 segmentos balanceados', () => {
  const segments = StreamerRouletteService.getWheelSegments();
  assert.equal(segments.length, 8);
  const totalWeight = segments.reduce((sum, s) => sum + s.weight, 0);
  assert.equal(totalWeight, 100);

  segments.forEach((s, idx) => {
    assert.ok(s.id, `Segmento ${idx} deve ter id`);
    assert.ok(s.name, `Segmento ${idx} deve ter name`);
    assert.ok(s.icon, `Segmento ${idx} deve ter icon`);
    assert.ok(s.color, `Segmento ${idx} deve ter color`);
    assert.ok(['fichas', 'extra_life', 'item'].includes(s.type));
  });
});

test('StreamerRouletteService: pickPrize deve retornar prêmio e segmentIndex válido (0 a 7)', () => {
  for (let i = 0; i < 20; i++) {
    const { prize, segmentIndex } = StreamerRouletteService.pickPrize(true);
    assert.ok(segmentIndex >= 0 && segmentIndex < 8, 'segmentIndex deve estar entre 0 e 7');
    assert.ok(prize, 'prize deve existir');
    assert.ok(prize.name, 'prize deve ter nome');
  }
});

test('ShopModel: addItemToInventory adiciona item ao inventário com persistência', async () => {
  const testUserId = 'test-roulette-user-' + Date.now();
  const res = await ShopModel.addItemToInventory(testUserId, 'nitro_booster', 2);
  assert.ok(res);
  assert.equal(res.user_id, testUserId);
  assert.equal(res.item_id, 'nitro_booster');
  assert.equal(res.quantity, 2);

  const found = await ShopModel.findUserInventoryItem(testUserId, 'nitro_booster');
  assert.ok(found);
  assert.equal(found.quantity, 2);
});
