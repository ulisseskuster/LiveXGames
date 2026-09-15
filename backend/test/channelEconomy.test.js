const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
process.env.DATABASE_URL = '';
const store = require('../src/data/store');
const Wallet = require('../src/services/streamerWalletService');
const Shop = require('../src/services/shopService');
const Games = require('../src/services/gameRunService');
const Rewards = require('../src/services/streamerRewardService');
const Roulette = require('../src/services/streamerRouletteService');
const Verifier = require('../src/services/sim/runVerifier');
after(() => Verifier.encerrar());

function fixture() {
  const user = {
    id: randomUUID(),
    username: randomUUID(),
    role: 'viewer',
    lives: 3,
    max_lives: 3,
    created_at: new Date().toISOString(),
    last_life_refill: new Date().toISOString()
  };
  const a = { id: randomUUID(), username: randomUUID(), role: 'streamer' };
  const b = { id: randomUUID(), username: randomUUID(), role: 'streamer' };
  store.users.push(user, a, b);
  store.wallets.push({ user_id: user.id, balance: 9000 });
  store.streamerWallets.push({ user_id: user.id, streamer_id: a.id, balance: 7000 });
  return { user, a, b };
}

test('canal A não financia compras, equipamentos ou brindes do canal B', async () => {
  const { user, a, b } = fixture();
  assert.equal(
    (await Wallet.getBalance(user.id, a.id)).balance,
    0,
    'histórico não vira crédito duplicado'
  );
  await Wallet.creditFromDonation(user.id, a.id, 1000);
  assert.equal((await Wallet.getBalance(user.id, b.id)).balance, 0);
  await assert.rejects(Shop.purchase(user.id, 'nitro_booster', 1, b.id), /INSUFFICIENT_BALANCE/);
  const purchase = await Shop.purchase(user.id, 'nitro_booster', 1, a.id);
  assert.equal(purchase.streamerId, a.id);
  assert.equal(purchase.balance, 950);
  assert.equal((await Shop.getUserInventory(user.id, a.id))[0].quantity, 1);
  assert.deepEqual(await Shop.getUserInventory(user.id, b.id), []);
  await assert.rejects(
    Games.iniciar(user.id, {
      gameId: 'jet_launcher',
      streamerId: b.id,
      itemIds: ['nitro_booster']
    }),
    /ITEM_NOT_IN_INVENTORY/
  );
  assert.equal(user.lives, 3, 'recusa devolve a vida');
  const reward = {
    id: randomUUID(),
    streamer_id: b.id,
    title: 'Brinde B',
    status: 'approved',
    delivery_type: 'digital',
    stock: 1,
    price_coins: 100
  };
  store.streamerRewards.push(reward);
  await assert.rejects(
    Rewards.redeemReward({ userId: user.id, rewardId: reward.id }),
    /INSUFFICIENT_BALANCE/
  );
  assert.equal(reward.stock, 1);
  assert.equal(store.wallets.find((w) => w.user_id === user.id).balance, 9000);
  assert.equal(store.streamerWallets.find((w) => w.user_id === user.id).balance, 7000);
});

for (const gameId of ['jet_launcher', 'neon_drifter', 'void_walker']) {
  test(`${gameId}: recibo imutável credita exclusivamente o canal de abertura`, async () => {
    const { user, a, b } = fixture();
    const run = await Games.iniciar(user.id, { gameId, streamerId: a.id });
    const receipt = await Games.finalizar(user.id, run.runId, { streamerId: b.id });
    assert.equal(receipt.streamerId, a.id);
    assert.equal((await Wallet.getBalance(user.id, a.id)).balance, receipt.coinsEarned);
    assert.equal((await Wallet.getBalance(user.id, b.id)).balance, 0);
    assert.deepEqual(await Games.finalizar(user.id, run.runId), receipt);
    assert.equal(user.lives, 2);
    assert.equal((await Wallet.getBalance(user.id, a.id)).balance, receipt.coinsEarned);
    const other = fixture().user;
    await assert.rejects(Games.finalizar(other.id, run.runId), /RUN_NOT_FOUND/);
  });
}

test('sandbox ignora o canal: não gasta vida nem inventário de streamer', async () => {
  const { user, a } = fixture();
  await Wallet.creditFromDonation(user.id, a.id, 500);
  await Shop.purchase(user.id, 'life_pack', 1, a.id);
  const run = await Games.iniciar(user.id, { gameId: 'sandbox', streamerId: a.id });
  assert.equal(run.streamerId, null);
  assert.equal((await Wallet.getBalance(user.id, a.id)).extraLives, 2);
  assert.equal(user.lives, 2);
});

test('canal ausente, inválido ou viewer é recusado antes de qualquer consumo', async () => {
  const { user } = fixture();
  for (const streamerId of [undefined, 'bad', randomUUID(), user.id]) {
    await assert.rejects(
      Games.iniciar(user.id, { gameId: 'jet_launcher', streamerId }),
      /INVALID_STREAMER/
    );
    await assert.rejects(
      Shop.purchase(user.id, 'nitro_booster', 1, streamerId),
      /INVALID_STREAMER/
    );
  }
  assert.equal(user.lives, 3);
});

test('quantidades malformadas não debitam; compras concorrentes não excedem o saldo', async () => {
  const { user, a } = fixture();
  await Wallet.creditFromDonation(user.id, a.id, 50);
  for (const quantity of ['2abc', '2', 1.5, [2], 0, -1, 101, Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(
      Shop.purchase(user.id, 'nitro_booster', quantity, a.id),
      /INVALID_QUANTITY/
    );
  }
  const results = await Promise.allSettled(
    [1, 2, 3].map(() => Shop.purchase(user.id, 'nitro_booster', 1, a.id))
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await Wallet.getBalance(user.id, a.id)).balance, 0);
});

test('vidas compradas e prêmios de roleta permanecem no canal de origem', async () => {
  const { user, a, b } = fixture();
  user.lives = 0;
  await Wallet.creditFromDonation(user.id, a.id, 500);
  await Shop.purchase(user.id, 'life_pack', 1, a.id);
  assert.equal(user.lives, 0);
  assert.equal((await Wallet.getBalance(user.id, a.id)).extraLives, 2);
  await assert.rejects(
    Games.iniciar(user.id, { gameId: 'void_walker', streamerId: b.id }),
    /NO_LIVES/
  );
  await Games.iniciar(user.id, { gameId: 'void_walker', streamerId: a.id });
  assert.equal((await Wallet.getBalance(user.id, a.id)).extraLives, 1);
  const pick = Roulette.pickPrize;
  try {
    Roulette.pickPrize = () => ({
      prize: { type: 'item', itemId: 'nitro_booster', amount: 1 },
      segmentIndex: 0
    });
    await Roulette.spin(user.id, b.id);
    assert.equal((await Shop.getUserInventory(user.id, b.id))[0].item_id, 'nitro_booster');
    assert.deepEqual(await Shop.getUserInventory(user.id, a.id), []);
  } finally {
    Roulette.pickPrize = pick;
  }
});
