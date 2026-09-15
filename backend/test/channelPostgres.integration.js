// Executar somente contra um banco descartável local chamado livex_channel_test*.
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const target = new URL(process.env.TEST_DATABASE_URL || 'http://invalid');
assert.ok(
  ['localhost', '127.0.0.1'].includes(target.hostname) &&
    target.pathname.startsWith('/livex_channel_test')
);
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATABASE_SSL = 'false';
process.env.NODE_ENV = 'test';
const db = require('../src/config/database');
const { runAutoMigration } = require('../src/db/autoMigrate');
const Users = require('../src/models/userModel');
const Wallet = require('../src/services/streamerWalletService');
const Shop = require('../src/services/shopService');
const Inventory = require('../src/models/channelInventoryModel');
const Games = require('../src/services/gameRunService');
const Runs = require('../src/models/gameRunModel');
const Rewards = require('../src/services/streamerRewardService');
const Verifier = require('../src/services/sim/runVerifier');

async function main() {
  await db.whenReady();
  assert.ok(db.isConnected());
  assert.equal((await runAutoMigration(db.pool)).success, true);
  const create = (role) =>
    Users.create({
      username: `pg_${randomUUID().slice(0, 12)}`,
      email: `${randomUUID()}@test.dev`,
      password: 'Local-Test-Only-2026!',
      role
    });
  const [user, a, b] = await Promise.all([
    create('viewer'),
    create('streamer'),
    create('streamer')
  ]);
  const legacy = (await db.query('SELECT balance FROM wallets WHERE user_id = $1', [user.id]))
    .rows[0].balance;
  await Promise.all(Array.from({ length: 5 }, () => Wallet.creditFromDonation(user.id, a.id, 100)));
  assert.equal(
    (await Wallet.getBalance(user.id, a.id)).balance,
    500,
    'upsert concorrente não perde créditos'
  );
  assert.equal((await Wallet.getBalance(user.id, b.id)).balance, 0);
  await assert.rejects(Shop.purchase(user.id, 'nitro_booster', 1, b.id), /INSUFFICIENT_BALANCE/);
  const purchases = await Promise.allSettled(
    Array.from({ length: 12 }, () => Shop.purchase(user.id, 'nitro_booster', 1, a.id))
  );
  assert.equal(purchases.filter((r) => r.status === 'fulfilled').length, 10);
  assert.equal((await Shop.getUserInventory(user.id, a.id))[0].quantity, 10);
  assert.deepEqual(await Shop.getUserInventory(user.id, b.id), []);
  await Wallet.creditFromDonation(user.id, a.id, 500);
  await assert.rejects(
    Inventory.purchase(user.id, a.id, { id: 'missing-fk', price: 1 }, 1),
    /foreign key/
  );
  assert.equal(
    (await Wallet.getBalance(user.id, a.id)).balance,
    500,
    'falha no inventário reverte débito SQL'
  );
  await Shop.purchase(user.id, 'life_pack', 1, a.id);
  assert.equal((await Wallet.getBalance(user.id, a.id)).extraLives, 2);
  for (const gameId of ['jet_launcher', 'neon_drifter', 'void_walker']) {
    const opening = await Games.iniciar(user.id, {
      streamerId: a.id,
      gameId,
      itemIds: gameId === 'jet_launcher' ? ['nitro_booster'] : []
    });
    const receipt = await Games.finalizar(user.id, opening.runId, { streamerId: b.id });
    assert.equal(receipt.streamerId, a.id);
    const before = (await Wallet.getBalance(user.id, a.id)).balance;
    const repeated = await Promise.all(
      Array.from({ length: 4 }, () => Games.finalizar(user.id, opening.runId))
    );
    assert.ok(repeated.every((r) => r.runId === receipt.runId));
    assert.equal((await Wallet.getBalance(user.id, a.id)).balance, before);
    assert.equal((await Wallet.getBalance(user.id, b.id)).balance, 0);
    const saved = await Runs.buscar(opening.runId, user.id);
    assert.equal(saved.streamer_id, a.id);
  }
  const rewardId = randomUUID();
  await db.query(
    `INSERT INTO streamer_rewards (id, streamer_id, title, description,
    price_coins, stock, image_url, delivery_type, status)
    VALUES ($1, $2, 'Brinde B', 'Teste SQL', 100, 1, '', 'digital', 'approved')`,
    [rewardId, b.id]
  );
  await assert.rejects(
    Rewards.redeemReward({ userId: user.id, rewardId }),
    /WALLET_NOT_FOUND|INSUFFICIENT_BALANCE/
  );
  await Wallet.creditFromDonation(user.id, b.id, 100);
  const beforeA = (await Wallet.getBalance(user.id, a.id)).balance;
  const redemptions = await Promise.allSettled(
    [1, 2].map(() => Rewards.redeemReward({ userId: user.id, rewardId }))
  );
  assert.equal(redemptions.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await Wallet.getBalance(user.id, b.id)).balance, 0);
  assert.equal((await Wallet.getBalance(user.id, a.id)).balance, beforeA);
  assert.equal(
    (await db.query('SELECT balance FROM wallets WHERE user_id = $1', [user.id])).rows[0].balance,
    legacy
  );
  // Reaplicar a migração preserva saldos já isolados.
  await db.query(
    fs.readFileSync(
      path.resolve(__dirname, '../../database/migrations/022_channel_economy.sql'),
      'utf8'
    )
  );
  assert.equal((await Wallet.getBalance(user.id, a.id)).balance, beforeA);

  // Reset único (023): moedas, extratos e pontuações somem; o resto fica.
  await Games.iniciar(user.id, { gameId: 'sandbox' });
  const count = async (sql) => Number((await db.query(sql)).rows[0].n);
  const preservado = async () => ({
    inventory: (await Shop.getUserInventory(user.id, a.id))[0].quantity,
    lives: (await Wallet.getBalance(user.id, a.id)).extraLives,
    openRuns: await count(`SELECT COUNT(*) n FROM game_runs WHERE status = 'open'`),
    redemptions: await count('SELECT COUNT(*) n FROM reward_redemptions'),
    donations: await count('SELECT COUNT(*) n FROM donations')
  });
  const antes = await preservado();
  assert.equal(antes.openRuns, 1);
  assert.ok(await count('SELECT COUNT(*) n FROM channel_wallets WHERE balance <> 0'));
  assert.ok(await count('SELECT COUNT(*) n FROM flight_runs'));
  await db.query(
    fs.readFileSync(
      path.resolve(__dirname, '../../database/migrations/023_reset_moedas_e_pontuacoes.sql'),
      'utf8'
    )
  );
  for (const table of ['wallets', 'streamer_wallets', 'channel_wallets']) {
    assert.equal(await count(`SELECT COUNT(*) n FROM ${table} WHERE balance <> 0`), 0, table);
  }
  for (const table of [
    'transactions',
    'streamer_wallet_transactions',
    'channel_wallet_transactions',
    'flight_runs'
  ]) {
    assert.equal(await count(`SELECT COUNT(*) n FROM ${table}`), 0, table);
  }
  assert.equal(
    await count(`SELECT COUNT(*) n FROM game_runs WHERE status NOT IN ('open', 'verifying')`),
    0
  );
  assert.deepEqual(await preservado(), antes);

  // Maiores doadores do mural no SQL real: soma por doador, nome sem conta
  // agrupado sem caixa, 'Anônimo' de fora, outro canal de fora e janela de datas.
  const Donations = require('../src/models/donationModel');
  const doar = (extra) =>
    Donations.create({
      provider: 'livepix',
      externalId: `pg-${randomUUID()}`,
      coinsCredited: 0,
      streamerId: a.id,
      ...extra
    });
  await doar({ userId: user.id, amountCents: 1000, metadata: { message: 'oi' } });
  await doar({ userId: user.id, amountCents: 2500, metadata: {} });
  await doar({ userId: null, amountCents: 700, metadata: { username: 'Visitante' } });
  await doar({ userId: null, amountCents: 99900, metadata: { username: 'Anônimo' } });
  await doar({
    userId: null,
    amountCents: 50000,
    streamerId: b.id,
    metadata: { username: 'Outro' }
  });
  const antiga = await doar({
    userId: null,
    amountCents: 5000,
    metadata: { username: 'visitante' }
  });
  await db.query(`UPDATE donations SET created_at = NOW() - INTERVAL '40 days' WHERE id = $1`, [
    antiga.id
  ]);
  const semana = await Donations.topDonors({ streamerId: a.id, period: 'weekly', limit: 10 });
  assert.deepEqual(
    semana.map((r) => [Number(r.total_cents), Number(r.donations_count)]),
    [
      [3500, 2],
      [700, 1]
    ]
  );
  const sempre = await Donations.topDonors({ streamerId: a.id, period: 'all', limit: 10 });
  assert.deepEqual(
    sempre.map((r) => Number(r.total_cents)),
    [5700, 3500]
  );
  // Conquistas e dashboard precisam ser exercitados com o schema real.
  const Achievements = require('../src/services/achievementService');
  const Dashboard = require('../src/services/streamerDashboardService');
  const [pilot, channel] = await Promise.all([create('viewer'), create('streamer')]);
  const unlocks = await Promise.all(
    Array.from({ length: 4 }, () => Achievements.unlock(pilot.id, 'first_flight'))
  );
  assert.equal(unlocks.filter(Boolean).length, 1, 'conquista só é anunciada uma vez');
  for (const amount of [1000, 2500]) {
    await db.query(
      `INSERT INTO game_runs (user_id, streamer_id, game_id, seed, sim_version,
       status, result, expires_at) VALUES ($1, $2, 'jet_launcher', '1', 1,
       'verified', $3, NOW() + INTERVAL '1 hour')`,
      [pilot.id, channel.id, JSON.stringify({ score: 1200, itemsUsed: ['nitro_booster'] })]
    );
    await doar({ userId: pilot.id, streamerId: channel.id, amountCents: amount });
  }
  assert.deepEqual(await Achievements.streamerRanking(channel.id), [
    { user_id: pilot.id, username: pilot.username, achievement_count: 1 }
  ]);
  const series = await Dashboard.dailySeries(channel.id, 1);
  const today = series.at(-1);
  assert.equal(today.rounds, 2, 'doações não multiplicam rodadas');
  assert.equal(today.donations, 2, 'rodadas não multiplicam doações');
  assert.equal(Number(today.amountCents), 3500);
  assert.deepEqual(await Dashboard.topItems(channel.id), [{ item_id: 'nitro_booster', uses: 2 }]);
  assert.equal((await Dashboard.topPlayers(channel.id))[0].best_score, 1200);
  const Leaderboard = require('../src/services/leaderboardService');
  const channelRank = (await Leaderboard.getStreamerRanking(50)).find(
    (row) => row.username === channel.username
  );
  assert.deepEqual(channelRank, {
    username: channel.username,
    players: 1,
    rounds: 2,
    donationCents: 3500
  });
  assert.ok(!(await Achievements.checkAndUnlock(pilot.id)).includes('first_flight'));
  assert.deepEqual(await Achievements.checkAndUnlock(pilot.id), []);

  const Notifications = require('../src/models/notificationModel');
  const endpoint = `https://push.example.com/${pilot.id}`;
  await Notifications.upsertSubscription({
    userId: pilot.id,
    endpoint,
    keysAuth: 'test-auth',
    keysP256dh: 'test-key'
  });
  assert.equal(await Notifications.deleteSubscription(endpoint, channel.id), null);
  assert.equal((await Notifications.subscriptionsForUser(pilot.id)).length, 1);
  assert.ok(await Notifications.deleteSubscription(endpoint, pilot.id));
  const notification = await Notifications.createNotification({
    userId: pilot.id,
    title: 'Teste SQL',
    body: 'Central de notificações'
  });
  assert.equal(await Notifications.countUnread(pilot.id), 1);
  assert.equal(await Notifications.markRead(channel.id, notification.id), null);
  await Notifications.markRead(pilot.id, notification.id);
  assert.equal(await Notifications.countUnread(pilot.id), 0);
  const Streak = require('../src/models/streakModel');
  await Promise.all(Array.from({ length: 4 }, () => Streak.registrarAtividade(pilot.id)));
  assert.equal((await Streak.getStreak(pilot.id)).current, 1);

  console.log(
    'PASS: PostgreSQL real — economia, três jogos, recibos idempotentes, conquistas, dashboard, rankings, notificações e streak.'
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Verifier.encerrar();
    await db.pool.end();
  });
