// Fase 2 (P0-B): abertura de rodada com intenção persistente.
//
// O fluxo antigo consumia vida + reservava itens e só DEPOIS gravava a rodada:
// queda entre o débito e o INSERT perdia tudo (vida 3→2, item 1→0, nada gravado).
//
// Estes testes rodam sem banco (InMemoryStore): verificam o comportamento do
// serviço de intenção — reserving não vira open sem confirmação, falha na
// geração devolve recursos, intenção órfã é recuperável, e idempotência.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.DATABASE_URL = '';

const GameRunService = require('../src/services/gameRunService');
const GameRunModel = require('../src/models/gameRunModel');
const ChannelInventoryModel = require('../src/models/channelInventoryModel');
const UserModel = require('../src/models/userModel');
const ShopModel = require('../src/models/shopModel');
const InMemoryStore = require('../src/data/store');

const ESCUDO = 'teste_sandbox_escudo_f2';

// Item de teste precisa existir no catálogo em memória.
if (!InMemoryStore.shopItems.some((i) => i.id === ESCUDO)) {
  InMemoryStore.shopItems.push({
    id: ESCUDO,
    gameId: 'sandbox',
    name: 'Escudo de teste F2',
    type: 'shield',
    price: 1,
    rarity: 'common',
    icon: '🧪',
    stock: 999,
    is_active: true,
    flight_bonus: { effect: 'shield', activation: 'auto', charges: 1 }
  });
}

async function novoPiloto(prefixo) {
  const sufixo = crypto.randomBytes(4).toString('hex');
  return UserModel.create({
    username: `${prefixo}_${sufixo}`,
    email: `${prefixo}_${sufixo}@teste.dev`,
    password: 'senha123456',
    role: 'viewer'
  });
}

async function quantidade(userId, itemId) {
  const inv = await ShopModel.findUserInventoryItem(userId, itemId);
  return inv ? inv.quantity : 0;
}

async function vidas(userId) {
  return (await UserModel.findById(userId)).lives;
}

test('intenção reserving não vira open sem confirmação (geração falhou)', async () => {
  const piloto = await novoPiloto('f2_intencao');
  await ShopModel.addItemToInventory(piloto.id, ESCUDO, 1);
  const vidasAntes = await vidas(piloto.id);

  // Simula o fluxo sem banco: registra a intenção em 'reserving' diretamente.
  const intencao = await GameRunModel.abrir({
    userId: piloto.id,
    gameId: 'sandbox',
    seed: crypto.randomBytes(32).toString('hex'),
    simVersion: 1,
    loadout: { itemIds: [ESCUDO], bytes: 'AAAA', items: [] },
    usedSubLife: false,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    status: 'reserving'
  });
  assert.equal(intencao.status, 'reserving', 'intenção começa reserving');

  // Sem confirmarIntencao, o usuário ainda não "abriu" uma rodada jogável.
  const abertas = InMemoryStore.gameRuns.filter(
    (r) => r.user_id === piloto.id && (r.status === 'open' || r.status === 'verifying')
  );
  assert.equal(abertas.length, 0, 'nenhuma open antes da confirmação');

  // Envelhece para a recuperação de intenção órfã.
  const raw = InMemoryStore.gameRuns.find((r) => r.id === intencao.id);
  raw.created_at = new Date(Date.now() - 120_000).toISOString();

  // Recuperação de intenção órfã: devolve recursos e marca abandoned.
  const abandonadas = await GameRunModel.abandonarReservingStale({ maxAgeMs: 60_000 });
  assert.ok(abandonadas.length >= 1, 'intenção órfã recuperada');
  assert.equal(await vidas(piloto.id), vidasAntes, 'vida não foi perdida (nunca debitada aqui)');
  assert.equal(await quantidade(piloto.id, ESCUDO), 1, 'item nunca saiu (intenção sem consumo)');
});

test('falha na abertura devolve vida e item (compensação manual sem banco)', async () => {
  const piloto = await novoPiloto('f2_falha');
  await ShopModel.addItemToInventory(piloto.id, ESCUDO, 1);
  const vidasAntes = await vidas(piloto.id);

  // Força falha na abertura: item não existe no inventário após a vida ser consumida.
  // O fluxo consome vida primeiro, tenta reservar item inexistente → erro.
  InMemoryStore.channelWalletTransactions.length = 0;
  InMemoryStore.channelWallets.length = 0;

  await assert.rejects(
    GameRunService.iniciar(piloto.id, {
      gameId: 'sandbox',
      itemIds: ['item_que_nao_existe_f2']
    }),
    /ITEM_NOT_IN_INVENTORY|ITEM_NOT_FOUND/
  );

  // A vida consumida no início deve ter sido devolvida pela compensação.
  assert.equal(await vidas(piloto.id), vidasAntes, 'vida devolvida após falha na reserva do item');
  assert.equal(await quantidade(piloto.id, ESCUDO), 1, 'item intacto');
});

test('abrir com sucesso gera rodada open com resultado, consumindo recursos', async () => {
  const piloto = await novoPiloto('f2_ok');
  await ShopModel.addItemToInventory(piloto.id, ESCUDO, 1);
  const vidasAntes = await vidas(piloto.id);

  const abertura = await GameRunService.iniciar(piloto.id, {
    gameId: 'sandbox',
    itemIds: [ESCUDO]
  });

  assert.equal(abertura.runId, abertura.runId);
  const run = InMemoryStore.gameRuns.find((r) => r.id === abertura.runId);
  assert.equal(run.status, 'open', 'rodada confirmada open');
  assert.equal(await vidas(piloto.id), vidasAntes - 1, 'vida consumida');
  assert.equal(await quantidade(piloto.id, ESCUDO), 0, 'item reservado');
});

test('intenção órfã com recursos debitados é recuperável (crash pós-débito)', async () => {
  const piloto = await novoPiloto('f2_crash');
  await ShopModel.addItemToInventory(piloto.id, ESCUDO, 1);
  const vidasAntes = await vidas(piloto.id);

  // Simula: o processo debitou vida + item e gravou intenção 'reserving',
  // depois caiu antes de gerar/confirmar.
  await UserModel.consumeLife(piloto.id);
  await ShopModel.reservarItem(piloto.id, ESCUDO);
  const intencao = await GameRunModel.abrir({
    userId: piloto.id,
    gameId: 'sandbox',
    seed: crypto.randomBytes(32).toString('hex'),
    simVersion: 1,
    loadout: { itemIds: [ESCUDO], bytes: 'AAAA', items: [] },
    usedSubLife: false,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    status: 'reserving'
  });
  assert.ok(intencao);

  // Envelhece a intenção para simular que o processo caiu há tempo suficiente.
  const rawIntencao = InMemoryStore.gameRuns.find((r) => r.id === intencao.id);
  rawIntencao.created_at = new Date(Date.now() - 120_000).toISOString();

  // A recuperação acontece no PRÓXIMO iniciar — que também abre uma rodada
  // nova e consome outra vida. Para isolar a devolução, chamamos a recuperação
  // (abandonarReservingStale + devolução) diretamente, como o serviço faz.
  const orfas = await GameRunModel.abandonarReservingStale({ maxAgeMs: 60_000 });
  const minha = orfas.find((r) => r.id === intencao.id);
  assert.ok(minha, 'intenção órfã recuperada');
  assert.equal(minha.status, 'abandoned', 'intenção órfã abandonada');
  await GameRunService.devolverItens(piloto.id, orfas);
  for (const orfa of orfas) {
    if (orfa.streamer_id) await ChannelInventoryModel.addLives(piloto.id, orfa.streamer_id, 1);
    else await GameRunService.devolverVida(piloto.id, orfa.used_sub_life);
  }

  assert.equal(await quantidade(piloto.id, ESCUDO), 1, 'item devolvido');
  assert.equal(await vidas(piloto.id), vidasAntes, 'vida devolvida');
});
