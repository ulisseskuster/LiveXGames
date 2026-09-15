const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const UserModel = require('../src/models/userModel');
const ShopModel = require('../src/models/shopModel');
const WalletModel = require('../src/models/streamerWalletModel');
const ChannelInventory = require('../src/models/channelInventoryModel');
const GameRunModel = require('../src/models/gameRunModel');
const CHANNEL = '33333333-3333-3333-3333-333333333333';
const GameRunService = require('../src/services/gameRunService');
const RunVerifier = require('../src/services/sim/runVerifier');
const { SimRuntime } = require('../src/services/sim/simRuntime');
const { multiplicadorDoItem } = require('../src/services/sim/scoreBonus');
const { JWT_SECRET } = require('../src/config/secrets');
const Economy = require('../src/services/economy');
let runtime;
test.before(async () => {
  // Espera o ping inicial do Postgres: sem isso, o primeiro piloto() desta
  // suíte pode nascer no InMemoryStore antes de isAvailable() virar true,
  // e uma chamada seguinte já autoritativa referencia um ID que não existe
  // na tabela real (violação de chave estrangeira mais adiante).
  await require('../src/config/database').whenReady();
  runtime = await SimRuntime.load();
});
test.after(() => RunVerifier.encerrar());
async function piloto() {
  const id = crypto.randomBytes(5).toString('hex');
  return UserModel.create({
    username: `cinema_${id}`,
    email: `${id}@test.dev`,
    password: 'senha123456',
    role: 'viewer'
  });
}
const saldo = async (id) => Number((await WalletModel.findByUserAndStreamer(id, CHANNEL)).balance);
const chaveDasRodadas = () =>
  crypto.createHmac('sha256', JWT_SECRET).update('livex:rodadas:v1').digest();

for (const [gameId, itemIds] of [
  ['jet_launcher', ['nitro_booster', 'extra_fuel']],
  ['neon_drifter', ['nos_injection', 'drift_tires', 'emp_shield']],
  ['void_walker', ['quantum_jump', 'dark_matter', 'plasma_shield']]
]) {
  test(`${gameId}: resultado, crédito e consumíveis ficam definidos no clique; cliente não os altera`, async () => {
    const p = await piloto();
    for (const id of itemIds) await ChannelInventory.add(p.id, CHANNEL, id, 1);
    const antes = await saldo(p.id);
    const abertura = await GameRunService.iniciar(p.id, { streamerId: CHANNEL, gameId, itemIds });
    assert.equal(abertura.seed, null);
    const persistida = await GameRunModel.buscar(abertura.runId, p.id);
    assert.equal(persistida.status, 'verified');
    assert.ok(persistida.input_log);
    assert.equal((await UserModel.findById(p.id)).lives, 2);
    const revelada = await GameRunService.revelar(p.id, abertura.runId);
    const deNovo = await GameRunService.revelar(p.id, abertura.runId);
    assert.deepEqual(revelada, deNovo);
    assert.equal(
      crypto
        .createHash('sha256')
        .update(`${revelada.seed}:${revelada.generatedResult.botSeed}`)
        .digest('hex'),
      abertura.commitment
    );
    // A semente é o HMAC da chave derivada do JWT_SECRET: ninguém fora do servidor a escolhe.
    assert.equal(
      revelada.seed,
      crypto
        .createHmac('sha256', chaveDasRodadas())
        .update(`${p.id}:${gameId}:${revelada.generatedResult.nonce}`)
        .digest('hex')
    );
    const replay = runtime.replay({
      gameCode: revelada.gameCode,
      seed: Buffer.from(revelada.seed, 'hex'),
      loadout: Buffer.from(revelada.loadout, 'base64'),
      log: Buffer.from(revelada.replayLog, 'base64')
    });
    assert.equal(replay.result.hash, revelada.generatedResult.hash);
    assert.equal(replay.result.score, revelada.generatedResult.baseScore);
    assert.ok(replay.result.ticks >= 15 * 60 && replay.result.ticks <= 20 * 60);
    const itens = [];
    let mult = 1;
    for (const id of itemIds) {
      const item = await ShopModel.findItemById(id);
      itens.push(item);
      mult *= multiplicadorDoItem(item);
      const noInventario = (await ChannelInventory.list(p.id, CHANNEL)).find(
        (i) => i.item_id === id
      ) || { quantity: 0 };
      assert.equal(Number(noInventario?.quantity || 0), 0);
    }
    mult = Math.round(mult * 1e6) / 1e6;
    assert.equal(revelada.generatedResult.scoreMultiplier, mult);
    assert.equal(revelada.generatedResult.score, Math.round(replay.result.score * mult));
    const moedas = Economy.moedasDaRodada(gameId, replay.result.distance, itens).total;
    assert.equal(revelada.generatedResult.coinsEarned, moedas);
    assert.equal(await saldo(p.id), antes + moedas);
    // O navegador pode fabricar até um log válido com outra rota; a liquidação
    // só consulta o recibo já salvo e não reexecuta dados escolhidos pelo cliente.
    const falso = runtime.jogarComBot({
      gameCode: revelada.gameCode,
      seed: Buffer.alloc(32, 9),
      loadout: Buffer.alloc(0),
      botSeed: 99
    });
    const resultados = await Promise.all(
      Array.from({ length: 4 }, () =>
        GameRunService.finalizar(p.id, abertura.runId, {
          log: falso.log.toString('base64'),
          clientHash: falso.result.hash,
          score: 999999999,
          scoreMultiplier: 999
        })
      )
    );
    for (const resultado of resultados) {
      assert.equal(resultado.score, revelada.generatedResult.score);
      assert.equal(resultado.hash, revelada.generatedResult.hash);
      assert.equal(resultado.baseScore, replay.result.score);
      assert.equal(resultado.coinsEarned, moedas);
    }
    assert.equal(await saldo(p.id), antes + moedas);
    const outro = await piloto();
    await assert.rejects(GameRunService.revelar(outro.id, abertura.runId), /RUN_NOT_FOUND/);
    await assert.rejects(GameRunService.finalizar(outro.id, abertura.runId, {}), /RUN_NOT_FOUND/);
    // Preços atualizados não recalculam uma rodada antiga.
    const item = await ShopModel.findItemById(itemIds[0]);
    const preco = item.price;
    try {
      item.price = 9999;
      const recibo = await GameRunService.finalizar(p.id, abertura.runId, {});
      assert.equal(recibo.score, resultados[0].score);
      assert.equal(recibo.coinsEarned, moedas);
    } finally {
      item.price = preco;
    }
  });
}

test('bônus de pontos aumenta com preço e raridade; cosméticos e vidas não multiplicam', () => {
  const item = { price: 25, rarity: 'common', type: 'utility' };
  assert.equal(multiplicadorDoItem(item), 1.25);
  assert.equal(multiplicadorDoItem({ ...item, rarity: 'rare' }), 1.375);
  assert.equal(multiplicadorDoItem({ ...item, rarity: 'epic' }), 1.5);
  assert.equal(multiplicadorDoItem({ ...item, price: 50 }), 1.5);
  assert.equal(multiplicadorDoItem({ ...item, type: 'cosmetic', rarity: 'legendary' }), 1);
  assert.equal(multiplicadorDoItem({ ...item, type: 'lives' }), 1);
});

for (const [gameId, itemId, providers] of [
  ['jet_launcher', 'nitro_booster', ['twitch']],
  ['neon_drifter', 'nos_injection', ['kick']],
  ['void_walker', 'quantum_jump', ['twitch', 'kick']]
]) {
  test(`${gameId}: subscriber soma 20% aos pontos, não às moedas, e conserva o recibo`, async () => {
    const p = await piloto();
    for (const provider of providers)
      await UserModel.linkStreamAccount(p.id, {
        provider,
        accountUsername: `${provider}_${p.username}`,
        isSubscriber: true
      });
    await ChannelInventory.add(p.id, CHANNEL, itemId, 1);
    const item = await ShopModel.findItemById(itemId);
    const abertura = await GameRunService.iniciar(p.id, {
      streamerId: CHANNEL,
      gameId,
      itemIds: [itemId]
    });
    const revelada = await GameRunService.revelar(p.id, abertura.runId);
    const r = await GameRunService.finalizar(p.id, abertura.runId);
    assert.equal(r.subscriberMultiplier, 1.2);
    assert.equal(r.itemScoreMultiplier, multiplicadorDoItem(item));
    assert.equal(r.score, Math.round(r.baseScore * r.scoreMultiplier));
    assert.equal(r.scoreMultiplier, Math.round(r.itemScoreMultiplier * 1.2 * 1e6) / 1e6);
    assert.equal(r.coinsEarned, Economy.moedasDaRodada(gameId, r.distance, [item]).total);
    assert.equal(revelada.generatedResult.subscriberMultiplier, 1.2);
    for (const provider of providers) await UserModel.unlinkStreamAccount(p.id, provider);
    assert.deepEqual(
      await GameRunService.finalizar(p.id, abertura.runId, { subscriberMultiplier: 99 }),
      r
    );
    const normal = await GameRunService.iniciar(p.id, {
      streamerId: CHANNEL,
      gameId,
      subscriberMultiplier: 99
    });
    assert.equal(
      (await GameRunService.revelar(p.id, normal.runId)).generatedResult.subscriberMultiplier,
      1
    );
  });
}

test('itens excedentes, repetidos e de outro jogo não gastam vida nem inventário', async () => {
  const p = await piloto();
  await ChannelInventory.add(p.id, CHANNEL, 'nitro_booster', 2);
  for (const itemIds of [
    ['nitro_booster', 'shield_deflector', 'extra_fuel', 'flare_chaff'],
    ['nitro_booster', 'nitro_booster'],
    ['flare_chaff'],
    ['nos_injection']
  ])
    await assert.rejects(
      GameRunService.iniciar(p.id, { streamerId: CHANNEL, gameId: 'jet_launcher', itemIds }),
      /INVALID_LOADOUT|ITEM_NOT_FOUND|ITEM_WRONG_GAME/
    );
  assert.equal((await UserModel.findById(p.id)).lives, 3);
  assert.equal(
    (
      (await ChannelInventory.list(p.id, CHANNEL)).find((i) => i.item_id === 'nitro_booster') || {
        quantity: 0
      }
    ).quantity,
    2
  );
});

test('falha ao gerar não deixa vida nem itens debitados', async () => {
  const p = await piloto();
  await ChannelInventory.add(p.id, CHANNEL, 'nitro_booster', 1);
  const gerar = RunVerifier.gerar;
  RunVerifier.gerar = async () => {
    throw new Error('GENERATION_FAILED');
  };
  try {
    await assert.rejects(
      GameRunService.iniciar(p.id, {
        streamerId: CHANNEL,
        gameId: 'jet_launcher',
        itemIds: ['nitro_booster']
      }),
      /GENERATION_FAILED/
    );
  } finally {
    RunVerifier.gerar = gerar;
  }
  assert.equal((await UserModel.findById(p.id)).lives, 3);
  assert.equal(
    (
      (await ChannelInventory.list(p.id, CHANNEL)).find((i) => i.item_id === 'nitro_booster') || {
        quantity: 0
      }
    ).quantity,
    1
  );
});

test('falha após salvar o sorteio recupera o mesmo resultado sem devolver o consumível premiado', async () => {
  const p = await piloto();
  await ChannelInventory.add(p.id, CHANNEL, 'nos_injection', 1);
  const liquidar = GameRunModel.liquidarGerada;
  GameRunModel.liquidarGerada = async () => {
    throw new Error('BANCO_INTERROMPIDO');
  };
  try {
    await assert.rejects(
      GameRunService.iniciar(p.id, {
        streamerId: CHANNEL,
        gameId: 'neon_drifter',
        itemIds: ['nos_injection']
      }),
      /BANCO_INTERROMPIDO/
    );
  } finally {
    GameRunModel.liquidarGerada = liquidar;
  }
  const pendentes = await GameRunModel.geradasPendentes(p.id);
  assert.equal(pendentes.length, 1);
  const { score, coinsEarned } = pendentes[0].result;
  const antes = await saldo(p.id);
  await Promise.all([
    GameRunService.recuperarGeradas(p.id, null),
    GameRunService.recuperarGeradas(p.id, null)
  ]);
  const recibo = await GameRunService.finalizar(p.id, pendentes[0].id, {});
  assert.equal(recibo.score, score);
  assert.equal(recibo.coinsEarned, coinsEarned);
  assert.equal(await saldo(p.id), antes + coinsEarned);
  assert.equal(
    (
      (await ChannelInventory.list(p.id, CHANNEL)).find((i) => i.item_id === 'nos_injection') || {
        quantity: 0
      }
    ).quantity,
    0
  );
  assert.equal((await UserModel.findById(p.id)).lives, 2);
});

test('Postgres: erro ao salvar o histórico reverte a transação de crédito', async () => {
  const db = require('../src/config/database');
  const original = { isAvailable: db.isAvailable, connect: db.connect };
  const comandos = [];
  let liberado = false;
  db.isAvailable = () => true;
  db.connect = async () => ({
    query: async (sql) => {
      comandos.push(sql);
      if (sql.startsWith('SELECT'))
        return { rows: [{ status: 'open', result: { serverGenerated: true } }] };
      if (sql.startsWith('INSERT INTO wallets')) return { rows: [{ balance: 999 }] };
      if (sql.startsWith('INSERT INTO flight_runs')) throw new Error('FALHA_HISTORICO');
      return { rows: [] };
    },
    release: () => {
      liberado = true;
    }
  });
  try {
    await assert.rejects(
      GameRunModel.liquidarGerada('run', 'user', {
        coinsEarned: 20,
        itemsUsed: [],
        flightScript: []
      }),
      /FALHA_HISTORICO/
    );
  } finally {
    Object.assign(db, original);
  }
  assert.equal(comandos[0], 'BEGIN');
  assert.equal(comandos.at(-1), 'ROLLBACK');
  assert.equal(comandos.includes('COMMIT'), false);
  assert.equal(liberado, true);
});
