const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// Suíte do InMemoryStore: mexe em InMemoryStore.gameRuns e cadastra itens de
// teste só na memória. String vazia (não delete) para o dotenv não recarregar
// DATABASE_URL do .env. O caminho Postgres é coberto por authoritativeJet.test.js.
process.env.DATABASE_URL = '';

const GameRunService = require('../src/services/gameRunService');
const UserModel = require('../src/models/userModel');
const ShopModel = require('../src/models/shopModel');
const WalletModel = require('../src/models/walletModel');
const Economy = require('../src/services/economy');
const InMemoryStore = require('../src/data/store');
const RunVerifier = require('../src/services/sim/runVerifier');
const { SimRuntime } = require('../src/services/sim/simRuntime');

/**
 * Ciclo de partida verificada: quem paga o quê em cada
 * desfecho. O jogador é simulado pelo bot da crate rodando o mesmo .wasm.
 */

const ESCUDO = 'teste_sandbox_escudo';
const PNEU = 'teste_sandbox_pneu';
let rt;

test.before(async () => {
  // Espera o ping inicial do Postgres: sem isso, o primeiro novoPiloto() desta
  // suíte pode nascer no InMemoryStore antes de isAvailable() virar true,
  // e uma chamada seguinte já autoritativa referencia um ID que não existe
  // na tabela real (violação de chave estrangeira mais adiante).
  await require('../src/config/database').whenReady();
  rt = await SimRuntime.load();
  const itens = [
    {
      id: ESCUDO,
      gameId: 'sandbox',
      name: 'Escudo de teste',
      type: 'shield',
      flight_bonus: { effect: 'shield', activation: 'auto', charges: 1 }
    },
    {
      // Aderência: efeito que o sandbox não implementa, então nunca é "usado".
      id: PNEU,
      gameId: 'sandbox',
      name: 'Pneu de teste',
      type: 'utility',
      flight_bonus: { effect: 'grip', activation: 'passive', magnitude: 1.4 }
    }
  ];
  for (const item of itens) {
    if (!InMemoryStore.shopItems.some((i) => i.id === item.id)) {
      InMemoryStore.shopItems.push({
        ...item,
        price: 1,
        rarity: 'common',
        icon: '🧪',
        stock: 999,
        is_active: true
      });
    }
  }
});
test.after(() => RunVerifier.encerrar());

async function novoPiloto(prefixo) {
  const sufixo = crypto.randomBytes(4).toString('hex');
  return UserModel.create({
    username: `${prefixo}_${sufixo}`,
    email: `${prefixo}_${sufixo}@teste.dev`,
    password: 'senha123456',
    role: 'viewer'
  });
}

function jogar(abertura, { botSeed = 3, sairNoTick = null } = {}) {
  return rt.jogarComBot({
    gameCode: abertura.gameCode,
    seed: Buffer.from(abertura.seed, 'hex'),
    loadout: Buffer.from(abertura.loadout, 'base64'),
    botSeed,
    sairNoTick
  });
}

const enviar = (partida) => ({
  log: partida.log.toString('base64'),
  clientHash: partida.result.hash
});

async function quantidade(userId, itemId) {
  const inv = await ShopModel.findUserInventoryItem(userId, itemId);
  return inv ? inv.quantity : 0;
}

async function saldo(userId) {
  return Number((await WalletModel.findByUserId(userId)).balance);
}

async function vidas(userId) {
  return (await UserModel.findById(userId)).lives;
}

test('partida verificada: vida e itens saem na abertura, moeda vem da distância do servidor e o item que não agiu volta', async () => {
  const piloto = await novoPiloto('run_ok');
  await ShopModel.addItemToInventory(piloto.id, ESCUDO, 1);
  await ShopModel.addItemToInventory(piloto.id, PNEU, 1);

  const abertura = await GameRunService.iniciar(piloto.id, {
    gameId: 'sandbox',
    itemIds: [ESCUDO, PNEU]
  });
  assert.equal(await vidas(piloto.id), 2);
  assert.equal(await quantidade(piloto.id, ESCUDO), 0, 'item reservado sai do inventário');
  assert.equal(await quantidade(piloto.id, PNEU), 0);

  const partida = jogar(abertura);
  const antes = await saldo(piloto.id);
  const oficial = await GameRunService.finalizar(piloto.id, abertura.runId, enviar(partida));

  assert.equal(oficial.distance, partida.result.distance);
  assert.equal(oficial.clientHashMatches, true);
  assert.equal(oficial.coinsEarned, Economy.coinsFromDistance('sandbox', oficial.distance));
  assert.equal(await saldo(piloto.id), antes + oficial.coinsEarned);

  assert.deepEqual(oficial.itemsReturned.includes(PNEU), true);
  assert.equal(await quantidade(piloto.id, PNEU), 1, 'efeito que não agiu não gasta o item');
  const escudoAgiu = (partida.result.itemsUsedMask & 1) === 1;
  assert.equal(oficial.itemsUsed.includes(ESCUDO), escudoAgiu);
  assert.equal(await quantidade(piloto.id, ESCUDO), escudoAgiu ? 0 : 1);
});

test('a mesma partida não pode ser terminada duas vezes, nem em paralelo', async () => {
  const piloto = await novoPiloto('run_dupla');
  const abertura = await GameRunService.iniciar(piloto.id, { gameId: 'sandbox' });
  const partida = jogar(abertura);
  const antes = await saldo(piloto.id);

  const [a, b] = await Promise.allSettled([
    GameRunService.finalizar(piloto.id, abertura.runId, enviar(partida)),
    GameRunService.finalizar(piloto.id, abertura.runId, enviar(partida))
  ]);
  const ok = [a, b].filter((r) => r.status === 'fulfilled');
  const recusadas = [a, b].filter((r) => r.status === 'rejected');
  assert.equal(ok.length, 1);
  assert.match(recusadas[0].reason.message, /RUN_ALREADY_FINISHED/);
  assert.equal(
    await saldo(piloto.id),
    antes + ok[0].value.coinsEarned,
    'moeda creditada uma vez só'
  );

  await assert.rejects(
    GameRunService.finalizar(piloto.id, abertura.runId, enviar(partida)),
    /RUN_ALREADY_FINISHED/
  );
});

test('abrir outra partida abandona a anterior: a vida dela fica gasta, os itens voltam', async () => {
  const piloto = await novoPiloto('run_abandono');
  await ShopModel.addItemToInventory(piloto.id, ESCUDO, 1);

  const primeira = await GameRunService.iniciar(piloto.id, {
    gameId: 'sandbox',
    itemIds: [ESCUDO]
  });
  assert.equal(await quantidade(piloto.id, ESCUDO), 0);

  await GameRunService.iniciar(piloto.id, { gameId: 'sandbox' });
  assert.equal(await quantidade(piloto.id, ESCUDO), 1);
  assert.equal(await vidas(piloto.id), 1);

  await assert.rejects(
    GameRunService.finalizar(piloto.id, primeira.runId, enviar(jogar(primeira))),
    /RUN_ALREADY_FINISHED/
  );
});

test('log adulterado é recusado: nenhuma moeda, a vida fica gasta e os itens voltam', async () => {
  const piloto = await novoPiloto('run_adulterado');
  await ShopModel.addItemToInventory(piloto.id, ESCUDO, 1);
  const abertura = await GameRunService.iniciar(piloto.id, {
    gameId: 'sandbox',
    itemIds: [ESCUDO]
  });
  const partida = jogar(abertura);
  const antes = await saldo(piloto.id);

  const truncado = partida.log.subarray(0, partida.log.length - 1).toString('base64');
  await assert.rejects(
    GameRunService.finalizar(piloto.id, abertura.runId, { log: truncado }),
    /RUN_REJECTED:BAD_LOG/
  );

  assert.equal(await saldo(piloto.id), antes);
  assert.equal(await quantidade(piloto.id, ESCUDO), 1);
  assert.equal(await vidas(piloto.id), 2);
});

test('item recusado na validação não custa vida', async () => {
  const piloto = await novoPiloto('run_item_errado');

  await assert.rejects(
    GameRunService.iniciar(piloto.id, { gameId: 'sandbox', itemIds: ['nitro_booster'] }),
    /ITEM_WRONG_GAME:nitro_booster/
  );
  // Universal, mas do esquema antigo de flight_bonus: não é equipável na partida.
  await assert.rejects(
    GameRunService.iniciar(piloto.id, { gameId: 'sandbox', itemIds: ['life_pack'] }),
    /ITEM_NOT_EQUIPPABLE:life_pack/
  );
  await assert.rejects(
    GameRunService.iniciar(piloto.id, { gameId: 'sandbox', itemIds: [ESCUDO, ESCUDO] }),
    /INVALID_LOADOUT/
  );
  await assert.rejects(
    GameRunService.iniciar(piloto.id, { gameId: 'sandbox', itemIds: 'escudo' }),
    /INVALID_LOADOUT/
  );
  assert.equal(await vidas(piloto.id), 3);
});

test('sem o item no inventário a abertura é desfeita por inteiro', async () => {
  const piloto = await novoPiloto('run_sem_item');
  await ShopModel.addItemToInventory(piloto.id, ESCUDO, 1);

  await assert.rejects(
    GameRunService.iniciar(piloto.id, { gameId: 'sandbox', itemIds: [ESCUDO, PNEU] }),
    /ITEM_NOT_IN_INVENTORY:teste_sandbox_pneu/
  );
  assert.equal(await vidas(piloto.id), 3, 'vida devolvida');
  assert.equal(await quantidade(piloto.id, ESCUDO), 1, 'reserva do primeiro item desfeita');
  assert.equal(
    InMemoryStore.gameRuns.some((r) => r.user_id === piloto.id),
    false,
    'nenhuma partida ficou aberta'
  );
});

test('partida expirada devolve os itens e não pode mais ser terminada', async () => {
  const piloto = await novoPiloto('run_expirada');
  await ShopModel.addItemToInventory(piloto.id, ESCUDO, 1);
  const abertura = await GameRunService.iniciar(piloto.id, {
    gameId: 'sandbox',
    itemIds: [ESCUDO]
  });
  const partida = jogar(abertura);

  InMemoryStore.gameRuns.find((r) => r.id === abertura.runId).expires_at = new Date(
    Date.now() - 1000
  ).toISOString();

  await assert.rejects(
    GameRunService.finalizar(piloto.id, abertura.runId, enviar(partida)),
    /RUN_EXPIRED/
  );
  assert.equal(await quantidade(piloto.id, ESCUDO), 1);
  await assert.rejects(
    GameRunService.finalizar(piloto.id, abertura.runId, enviar(partida)),
    /RUN_ALREADY_FINISHED/
  );
});

test('simulação atualizada durante a partida devolve vida e itens', async () => {
  const piloto = await novoPiloto('run_versao');
  await ShopModel.addItemToInventory(piloto.id, ESCUDO, 1);
  const abertura = await GameRunService.iniciar(piloto.id, {
    gameId: 'sandbox',
    itemIds: [ESCUDO]
  });
  InMemoryStore.gameRuns.find((r) => r.id === abertura.runId).sim_version = 999;

  await assert.rejects(
    GameRunService.finalizar(piloto.id, abertura.runId, enviar(jogar(abertura))),
    /SIM_VERSION_CHANGED/
  );
  assert.equal(await vidas(piloto.id), 3);
  assert.equal(await quantidade(piloto.id, ESCUDO), 1);
});

test('sair no meio vale o que foi percorrido até ali', async () => {
  const piloto = await novoPiloto('run_saiu');
  const abertura = await GameRunService.iniciar(piloto.id, { gameId: 'sandbox' });
  const partida = jogar(abertura, { sairNoTick: 120 });
  const oficial = await GameRunService.finalizar(piloto.id, abertura.runId, enviar(partida));
  assert.equal(oficial.endReason, 'quit');
  assert.equal(oficial.ticks, 120);
  assert.equal(oficial.distance, partida.result.distance);
});

test('jogo que ainda não migrou e sandbox em produção são recusados', async () => {
  const piloto = await novoPiloto('run_jogo');
  await assert.rejects(
    GameRunService.iniciar(piloto.id, { gameId: 'unknown_game' }),
    /INVALID_GAME_ID/
  );

  const ambiente = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(
      GameRunService.iniciar(piloto.id, { gameId: 'sandbox' }),
      /INVALID_GAME_ID/
    );
  } finally {
    if (ambiente === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ambiente;
  }
  assert.equal(await vidas(piloto.id), 3);
});
