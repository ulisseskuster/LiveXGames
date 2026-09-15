// @ts-check
/**
 * Checagem do ciclo de vidas diárias. Rode com: npm run test:unit
 *
 * O bug que estes testes travam: `consumeLife` debitava a vida mas nunca
 * carimbava `last_life_refill`. O campo ficava preso em `created_at`, e na
 * leitura seguinte `checkAndRefillLives` via 24h+ decorridas e devolvia a vida
 * recém-gasta. Na prática as vidas eram infinitas — dava para decolar em loop e
 * farmar moedas sem limite.
 */
const test = require('node:test');
const assert = require('node:assert');

const UserModel = require('../src/models/userModel');
const InMemoryStore = require('../src/data/store');

const ID = 'test-lives-user';

/** Insere um piloto limpo no store e devolve a referência viva. */
function criarPiloto({ lives = 3, maxLives = 3, role = 'viewer', ultimoRefill = null } = {}) {
  const existente = InMemoryStore.users.findIndex((u) => u.id === ID);
  if (existente >= 0) InMemoryStore.users.splice(existente, 1);

  const user = {
    id: ID,
    username: 'piloto_teste_vidas',
    email: 'vidas@example.com',
    role,
    lives,
    max_lives: maxLives,
    // Sem carimbo explícito, nasce "criado há 30 dias": é exatamente o estado
    // em que o bug se manifestava.
    last_life_refill: ultimoRefill,
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  };
  InMemoryStore.users.push(user);
  return user;
}

const horasAtras = (h) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

test('gastar a vida a partir do saldo cheio inicia o relógio de regeneração', async () => {
  const user = criarPiloto();

  const resultado = await UserModel.consumeLife(ID);

  assert.strictEqual(resultado.lives, 2, 'a vida deve ser debitada');
  assert.ok(user.last_life_refill, 'o carimbo de regeneração precisa ser gravado');
  const idadeEmMinutos = (Date.now() - new Date(user.last_life_refill).getTime()) / 60000;
  assert.ok(idadeEmMinutos < 1, 'o carimbo deve ser de agora, não a data de criação');
});

test('a vida gasta NÃO volta sozinha na leitura seguinte (o bug original)', async () => {
  criarPiloto();

  await UserModel.consumeLife(ID);
  const lido = await UserModel.findById(ID);

  assert.strictEqual(lido.lives, 2, 'a leitura não pode ressuscitar a vida recém-gasta');
});

test('as vidas acabam depois de gastar o saldo diário', async () => {
  criarPiloto();

  assert.strictEqual((await UserModel.consumeLife(ID)).lives, 2);
  assert.strictEqual((await UserModel.consumeLife(ID)).lives, 1);
  assert.strictEqual((await UserModel.consumeLife(ID)).lives, 0);
  assert.strictEqual(await UserModel.consumeLife(ID), null, 'sem saldo, deve recusar a partida');
});

test('regeneração passiva devolve 1 vida a cada 8 horas decorridas', async () => {
  criarPiloto({ lives: 1, ultimoRefill: horasAtras(16) });

  const lido = await UserModel.findById(ID);

  assert.strictEqual(lido.lives, 3, '16 horas decorridas devolvem 2 vidas, limitado ao máximo');
});

test('regeneração nunca ultrapassa o máximo do papel', async () => {
  criarPiloto({ lives: 3, ultimoRefill: horasAtras(500) });

  const lido = await UserModel.findById(ID);

  assert.strictEqual(lido.lives, 3, 'saldo cheio continua cheio');
});

test('streamer joga sem consumir vidas', async () => {
  criarPiloto({ role: 'streamer', lives: 999, maxLives: 999 });

  const resultado = await UserModel.consumeLife(ID);

  assert.strictEqual(resultado.lives, 999, 'streamer não é debitado');
});
