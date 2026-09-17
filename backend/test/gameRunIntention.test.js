// Abertura de rodada: vida, itens e intenção 'reserving' persistem juntos, e
// o estorno de intenções órfãs volta sempre ao DONO, uma única vez.
//
// Roda no armazenamento que o ambiente oferecer: em memória localmente e no
// PostgreSQL real no CI (DATABASE_URL do workflow). É no Postgres que os
// defeitos da auditoria de 17/09/2026 apareciam: reserva de itens fora da
// transação (clique duplo destruía o item) e órfãs de um usuário estornadas a
// quem abrisse a próxima rodada.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const db = require('../src/config/database');
const InMemoryStore = require('../src/data/store');
const GameRunService = require('../src/services/gameRunService');
const GameRunModel = require('../src/models/gameRunModel');
const ChannelInventory = require('../src/models/channelInventoryModel');
const WalletModel = require('../src/models/streamerWalletModel');
const UserModel = require('../src/models/userModel');
const RunVerifier = require('../src/services/sim/runVerifier');

const CHANNEL = '33333333-3333-3333-3333-333333333333';
const ITEM = 'nitro_booster';

test.before(() => db.whenReady());
test.after(() => RunVerifier.encerrar());

async function piloto(itens = 0) {
  const id = crypto.randomBytes(5).toString('hex');
  const p = await UserModel.create({
    username: `intencao_${id}`,
    email: `intencao_${id}@test.dev`,
    password: 'senha123456',
    role: 'viewer'
  });
  if (itens) await ChannelInventory.add(p.id, CHANNEL, ITEM, itens);
  return p;
}

const vidas = async (id) => (await UserModel.findById(id)).lives;
async function itens(id) {
  const linha = (await ChannelInventory.list(id, CHANNEL)).find((i) => i.item_id === ITEM);
  return linha ? Number(linha.quantity) : 0;
}
const saldo = async (id) => Number((await WalletModel.findByUserAndStreamer(id, CHANNEL)).balance);

/** Intenção 'reserving' com vida e item debitados, como se o processo tivesse caído depois. */
function reservar(userId, itemIds = [ITEM]) {
  return GameRunService.reservar(
    userId,
    CHANNEL,
    itemIds.map((id) => ({ id })),
    {
      gameId: 'jet_launcher',
      seed: crypto.randomBytes(32).toString('hex'),
      simVersion: 1,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: null,
      loadout: { itemIds, bytes: '', items: [] }
    }
  );
}

async function envelhecer(runId) {
  if (db.isAvailable()) {
    await db.query(
      `UPDATE game_runs SET created_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`,
      [runId]
    );
  } else {
    InMemoryStore.gameRuns.find((r) => r.id === runId).created_at = new Date(
      Date.now() - 10 * 60_000
    ).toISOString();
  }
}

const abrir = (userId, extra = {}) =>
  GameRunService.iniciar(userId, {
    gameId: 'jet_launcher',
    streamerId: CHANNEL,
    itemIds: [ITEM],
    ...extra
  });

test('com outra rodada em andamento, a abertura é recusada sem gastar vida nem item', async () => {
  const p = await piloto(2);
  const emAndamento = await reservar(p.id);
  const [vidasAntes, itensAntes] = [await vidas(p.id), await itens(p.id)];

  await assert.rejects(abrir(p.id), /^Error: RUN_ALREADY_OPEN$/);

  assert.equal(await vidas(p.id), vidasAntes, 'vida intacta');
  assert.equal(await itens(p.id), itensAntes, 'item intacto (antes era destruído)');
  assert.equal(await GameRunService.abandonarEEstornar(emAndamento.id, p.id), true);
});

test('clique duplo: cada rodada aberta gasta uma vida e um item, a recusada nada', async () => {
  const p = await piloto(2);
  const resultados = await Promise.allSettled([abrir(p.id), abrir(p.id)]);
  const abertas = resultados.filter((r) => r.status === 'fulfilled').length;

  assert.ok(abertas >= 1, 'pelo menos uma rodada abre');
  for (const r of resultados) {
    if (r.status === 'rejected') assert.equal(r.reason.message, 'RUN_ALREADY_OPEN');
  }
  assert.equal(await vidas(p.id), 3 - abertas);
  assert.equal(await itens(p.id), 2 - abertas);
});

test('órfã de um usuário é estornada ao próprio dono, não a quem abre a próxima rodada', async () => {
  const vitima = await piloto(1);
  const orfa = await reservar(vitima.id);
  await envelhecer(orfa.id);
  assert.equal(await itens(vitima.id), 0);
  assert.equal(await vidas(vitima.id), 2);

  const outro = await piloto(1);
  await abrir(outro.id);
  assert.equal(await itens(outro.id), 0, 'quem abriu não recebe o item alheio');
  assert.equal(await vidas(outro.id), 2, 'nem a vida alheia');
  assert.equal((await GameRunModel.buscar(orfa.id, vitima.id)).status, 'reserving');

  await GameRunService.recuperarOrfas();
  assert.equal((await GameRunModel.buscar(orfa.id, vitima.id)).status, 'abandoned');
  assert.equal(await itens(vitima.id), 1, 'item volta à vítima');
  assert.equal(await vidas(vitima.id), 3, 'vida volta à vítima');
});

test('abandonos simultâneos da mesma intenção estornam uma única vez', async () => {
  const p = await piloto(1);
  const orfa = await reservar(p.id);
  await envelhecer(orfa.id);

  const resultados = await Promise.all([
    GameRunService.recuperarOrfas({ userId: p.id }),
    GameRunService.recuperarOrfas({ userId: p.id }),
    GameRunService.abandonarEEstornar(orfa.id, p.id)
  ]);

  assert.equal(
    resultados.map(Number).reduce((a, b) => a + b),
    1,
    'um único estorno'
  );
  assert.equal(await itens(p.id), 1);
  assert.equal(await vidas(p.id), 3);
  // A geração que ainda estivesse viva não consegue mais abrir a rodada.
  const confirmada = await GameRunModel.confirmarIntencao(orfa.id, {
    result: null,
    inputLog: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });
  assert.equal(confirmada, null);
});

test('o dono volta a jogar logo após uma queda: a abertura recupera a própria órfã', async () => {
  const p = await piloto(2);
  const orfa = await reservar(p.id);
  await envelhecer(orfa.id);

  await abrir(p.id);

  assert.equal((await GameRunModel.buscar(orfa.id, p.id)).status, 'abandoned');
  assert.equal(await vidas(p.id), 2, 'órfã estornada, nova rodada debitada');
  assert.equal(await itens(p.id), 1);
});

test('mesmo requestId devolve a mesma rodada sem novo débito nem novo crédito', async () => {
  const p = await piloto(2);
  const requestId = `req_${crypto.randomBytes(6).toString('hex')}`;

  const primeira = await abrir(p.id, { requestId });
  const [vidasDepois, itensDepois, saldoDepois] = [
    await vidas(p.id),
    await itens(p.id),
    await saldo(p.id)
  ];
  const repetida = await abrir(p.id, { requestId });

  assert.deepEqual(repetida, primeira);
  assert.equal(await vidas(p.id), vidasDepois);
  assert.equal(await itens(p.id), itensDepois);
  assert.equal(await saldo(p.id), saldoDepois);

  const outra = await abrir(p.id, { requestId: `${requestId}_2` });
  assert.notEqual(outra.runId, primeira.runId, 'outro requestId é outra rodada');
  assert.equal(await vidas(p.id), vidasDepois - 1);
});
