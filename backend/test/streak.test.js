const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const StreakModel = require('../src/models/streakModel');
const InMemoryStore = require('../src/data/store');

// Sem DATABASE_URL a suíte roda inteira sobre o InMemoryStore, que espelha a
// semântica das queries do model. (Mesmo caminho dos demais testes.)

const USUARIO = '11111111-1111-1111-1111-111111111111';
const OUTRO = '22222222-2222-2222-2222-222222222222';

function setUltimaAtividade(userId, diasAtras) {
  const data = new Date(Date.now() - diasAtras * 86400000).toISOString().slice(0, 10);
  InMemoryStore.userStreaks.push({
    user_id: userId,
    current_streak: 5,
    best_streak: 12,
    last_activity_date: data,
    updated_at: new Date().toISOString()
  });
}

beforeEach(() => {
  InMemoryStore.userStreaks.length = 0;
});

test('primeira atividade cria streak em 1', async () => {
  const r = await StreakModel.registrarAtividade(USUARIO);
  assert.equal(r.current, 1);
  assert.equal(r.best, 1);
  assert.ok(r.lastActivityDate);
});

test('atividade no dia seguinte incrementa o streak', async () => {
  setUltimaAtividade(USUARIO, 1); // ontem, streak 5
  const r = await StreakModel.registrarAtividade(USUARIO);
  assert.equal(r.current, 6);
  assert.equal(r.best, 12, 'recorde não muda');
});

test('atividade no MESMO dia não incrementa duas vezes', async () => {
  setUltimaAtividade(USUARIO, 0); // hoje
  const r = await StreakModel.registrarAtividade(USUARIO);
  assert.equal(r.current, 5, 'jogou hoje: segue 5');
  assert.equal(r.best, 12);
});

test('quebra de sequência (mais de 1 dia) zera e recomeça em 1', async () => {
  setUltimaAtividade(USUARIO, 3); // 3 dias atrás
  const r = await StreakModel.registrarAtividade(USUARIO);
  assert.equal(r.current, 1);
  assert.equal(r.best, 12, 'recorde pessoal permanece');
});

test('streaks são independentes entre usuários', async () => {
  await StreakModel.registrarAtividade(USUARIO);
  await StreakModel.registrarAtividade(OUTRO);
  assert.equal((await StreakModel.getStreak(USUARIO)).current, 1);
  assert.equal((await StreakModel.getStreak(OUTRO)).current, 1);
});

test('getStreak sem atividade devolve zerado', async () => {
  const r = await StreakModel.getStreak('99999999-9999-9999-9999-999999999999');
  assert.deepEqual(r, { current: 0, best: 0, lastActivityDate: null });
});

test('getStreak reflete o que registrarAtividade gravou', async () => {
  await StreakModel.registrarAtividade(USUARIO);
  const r = await StreakModel.getStreak(USUARIO);
  assert.equal(r.current, 1);
  assert.equal(r.best, 1);
});
