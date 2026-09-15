const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');

// Suíte do InMemoryStore: os usuários são criados direto na memória. String vazia
// (não delete) para o dotenv não recarregar DATABASE_URL do .env.
process.env.DATABASE_URL = '';

const UserModel = require('../src/models/userModel');
const CHANNEL = '33333333-3333-3333-3333-333333333333';
const GameRunService = require('../src/services/gameRunService');
const RunVerifier = require('../src/services/sim/runVerifier');
const ShopService = require('../src/services/shopService');
const WalletModel = require('../src/models/streamerWalletModel');
const InMemoryStore = require('../src/data/store');

/**
 * A origem deste arquivo: o botão "Restaurar Vidas" do banner de vidas
 * esgotadas escrevia `state.user.lives = max_lives` no navegador e mais nada.
 * O contador enchia na tela, o servidor seguia em zero, e a decolagem seguinte
 * era recusada. O que estes testes fixam é o lado que decide: quem autoriza a
 * rodada é o backend, e nenhum caminho de interface muda isso.
 */

function criarUsuario({ role = 'viewer', lives = 3 } = {}) {
  const user = {
    id: randomUUID(),
    name: 'Piloto de Teste',
    username: `teste_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    email: `${randomUUID()}@example.com`,
    passwordHash: 'x',
    role,
    lives,
    max_lives: UserModel.getRoleMaxLives(role),
    last_life_refill: new Date().toISOString(),
    created_at: new Date().toISOString()
  };
  InMemoryStore.users.push(user);
  return user;
}

const jogar = (userId) =>
  GameRunService.iniciar(userId, { streamerId: CHANNEL, gameId: 'neon_drifter' });

beforeEach(() => {
  InMemoryStore.flightRuns = InMemoryStore.flightRuns || [];
});
after(() => RunVerifier.encerrar());

test('viewer sem vidas tem a rodada recusada pelo servidor', async () => {
  const user = criarUsuario({ lives: 0 });

  await assert.rejects(() => jogar(user.id), /NO_LIVES_REMAINING/);
});

test('encher as vidas apenas no cliente nao autoriza rodada: o servidor decide', async () => {
  const user = criarUsuario({ lives: 0 });

  // Exatamente o que o botão quebrado fazia: mexer no objeto que a tela lê,
  // sem tocar no estado que o backend consulta. Aqui o objeto do "cliente" é
  // uma cópia, e o servidor continua vendo zero.
  const estadoDaTela = { ...user, lives: 3 };
  assert.equal(estadoDaTela.lives, 3, 'a tela mostraria 3 vidas');

  await assert.rejects(
    () => jogar(user.id),
    /NO_LIVES_REMAINING/,
    'o servidor não pode aceitar a rodada só porque a tela diz outra coisa'
  );
});

test('setLives zera de verdade e a recusa passa a valer', async () => {
  const user = criarUsuario({ lives: 3 });

  await UserModel.setLives(user.id, 0);

  const relido = await UserModel.findById(user.id);
  assert.equal(relido.lives, 0, 'o zero precisa sobreviver à releitura');
  await assert.rejects(() => jogar(user.id), /NO_LIVES_REMAINING/);
});

test('setLives carimba last_life_refill: zerar nao e desfeito pela regeneracao', async () => {
  const user = criarUsuario({ lives: 3 });
  // Sem o carimbo, `created_at` antigo faria checkAndRefillLives enxergar 24h
  // vencidas e devolver as vidas sozinho na próxima leitura.
  user.created_at = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  await UserModel.setLives(user.id, 0);
  const relido = await UserModel.findById(user.id);

  assert.equal(relido.lives, 0, 'a regeneração não pode desfazer o zero recém-gravado');
});

test('setLives restaura ao maximo do papel e a rodada volta a ser aceita', async () => {
  const user = criarUsuario({ lives: 0 });

  const resultado = await UserModel.setLives(user.id, UserModel.getRoleMaxLives('viewer'));
  assert.equal(resultado.lives, 3);

  await jogar(user.id);
  assert.equal((await UserModel.findById(user.id)).lives, 2, 'a rodada consome uma vida real');
});

test('streamer nao gasta vida: por isso nao pode ver alerta de vidas esgotadas', async () => {
  const streamer = criarUsuario({ role: 'streamer', lives: 0 });

  // O servidor isenta o streamer do débito (consumeLife), então um streamer com
  // o contador em zero joga normalmente. Era essa a contradição do banner.
  const rodada = await jogar(streamer.id);
  assert.ok(rodada.runId, 'streamer joga mesmo com o contador em zero');
});

test('admin consome vida de verdade: para ele o alerta em zero e verdadeiro', async () => {
  const admin = criarUsuario({ role: 'admin', lives: 0 });

  await assert.rejects(() => jogar(admin.id), /NO_LIVES_REMAINING/);
});

test('comprar a Bateria de Vidas devolve vida de verdade e destrava a rodada', async () => {
  const user = criarUsuario({ lives: 0 });
  await WalletModel.addBalance(user.id, CHANNEL, 1000);

  const item = (await ShopService.listItems()).find((i) => i.id === 'life_pack');
  assert.ok(item, 'a Bateria de Vidas precisa estar no catálogo');
  assert.equal(item.gameId, 'all', 'precisa passar o filtro de jogo da vitrine');

  await ShopService.purchase(user.id, 'life_pack', 1, CHANNEL);

  const relido = await UserModel.findById(user.id);
  assert.equal(relido.lives, 0, 'vidas globais não mudam');
  assert.equal((await WalletModel.findByUserAndStreamer(user.id, CHANNEL)).extra_lives, 2);

  const rodada = await jogar(user.id);
  assert.ok(rodada.runId, 'e a rodada passa a ser aceita');
});
