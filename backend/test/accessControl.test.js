const test = require('node:test');
const assert = require('node:assert/strict');
const { app, podeEntrarNaSala } = require('../src/server');
const UserModel = require('../src/models/userModel');

const unico = () => Date.now().toString().slice(-8) + Math.floor(Math.random() * 999);

async function subirServidor() {
  const servidor = app.listen(0);
  await new Promise((resolve) => servidor.once('listening', resolve));
  return { servidor, url: `http://127.0.0.1:${servidor.address().port}` };
}

// Estes endpoints apagavam uma conta pelo nome sem exigir autenticação alguma,
// barrados apenas por NODE_ENV. Foram removidos; os testes garantem que não
// voltem por descuido.
test('reset-test-state nao existe mais', async (t) => {
  const { servidor, url } = await subirServidor();
  t.after(() => servidor.close());

  const res = await fetch(`${url}/api/auth/reset-test-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin_livex' })
  });
  assert.equal(res.status, 404);
});

test('DELETE /api/auth/test-user/:username nao existe mais', async (t) => {
  const { servidor, url } = await subirServidor();
  t.after(() => servidor.close());

  const res = await fetch(`${url}/api/auth/test-user/admin_livex`, { method: 'DELETE' });
  assert.equal(res.status, 404);
});

test('register ignora x-test-reset e nao apaga a conta existente', async (t) => {
  const { servidor, url } = await subirServidor();
  t.after(() => servidor.close());

  const id = unico();
  const username = `alvo_${id}`;
  const original = await UserModel.create({
    username,
    email: `${username}@test.com`,
    password: 'demo123Password',
    role: 'viewer'
  });

  // Uma requisição anônima tentando recriar a mesma conta com o cabeçalho de
  // reset: antes isso apagava a conta existente antes de registrar.
  const res = await fetch(`${url}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-reset': 'true' },
    body: JSON.stringify({
      name: 'Invasor',
      phone: '11999998888',
      username,
      email: `outro_${id}@test.com`,
      password: 'outraSenha123',
      birthDate: '1990-05-20',
      acceptedTerms: true,
      resetIfExists: true
    })
  });

  assert.equal(res.status, 409, 'deve recusar por username já existente');

  const aindaExiste = await UserModel.findByUsername(username);
  assert.ok(aindaExiste, 'a conta original nao pode ter sido apagada');
  assert.equal(aindaExiste.id, original.id, 'deve ser a mesma conta, nao uma recriada');
});

// Auditoria H-01: cópia do JWT no JSON fica ao alcance de script, extensão e log
// de proxy. A sessão existe só no cookie HttpOnly.
test('register e login entregam a sessão só no cookie HttpOnly', async (t) => {
  // Sem esperar a conexão, o cadastro pode cair no InMemoryStore e o login, já
  // com o Postgres no ar, não achar a conta (401).
  await require('../src/config/database').whenReady();
  const { servidor, url } = await subirServidor();
  t.after(() => servidor.close());

  const username = `cookie_${unico()}`;
  const cadastro = await fetch(`${url}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      email: `${username}@test.com`,
      password: 'senhaSegura123',
      birthDate: '1990-05-20',
      acceptedTerms: true
    })
  });
  const login = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'senhaSegura123' })
  });

  for (const [nome, res, status] of [
    ['register', cadastro, 201],
    ['login', login, 200]
  ]) {
    assert.equal(res.status, status, nome);
    const corpo = await res.json();
    assert.equal(corpo.data.user.username, username, nome);
    assert.equal(corpo.data.token, undefined, `${nome} não pode devolver o JWT no corpo`);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('livex_session='));
    assert.match(cookie || '', /HttpOnly/i, `${nome} precisa abrir a sessão no cookie`);
  }
});

// Cada jogo tem a própria escala de pontos; um ranking único seria sempre do Jet.
test('ranking é por jogo e período e recusa jogo ou período desconhecido', async (t) => {
  const { servidor, url } = await subirServidor();
  t.after(() => servidor.close());

  for (const invalido of ['sandbox', 'chrono_storm', 'constructor']) {
    const res = await fetch(`${url}/api/leaderboard/weekly?gameId=${invalido}`);
    assert.equal(res.status, 400, `gameId "${invalido}" deveria ser recusado`);
  }
  for (const periodo of ['yearly', 'constructor', '__proto__']) {
    const res = await fetch(`${url}/api/leaderboard/${periodo}?gameId=neon_drifter`);
    assert.equal(res.status, 404, `período "${periodo}" deveria ser recusado`);
  }
  for (const periodo of ['weekly', 'monthly', 'all']) {
    const res = await fetch(`${url}/api/leaderboard/${periodo}?gameId=neon_drifter`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((await res.json()).data));
  }
});

test('ranking mensal e desde o início incluem partidas além da semana', async () => {
  const db = require('../src/config/database');
  const store = require('../src/data/store');
  const LeaderboardService = require('../src/services/leaderboardService');
  await db.whenReady();
  const id = unico();
  const user = await UserModel.create({
    username: `rank_${id}`,
    email: `rank_${id}@test.com`,
    password: 'senhaSegura123',
    role: 'viewer'
  });
  for (const [i, dias] of [1, 10, 40].entries()) {
    const run = {
      id: require('crypto').randomUUID(),
      user_id: user.id,
      game_id: 'void_walker',
      distance: 100,
      max_altitude: 0,
      // Pontuação alta: o jogador precisa aparecer no topo mesmo com outras partidas no banco.
      score: 900000000 + i,
      coins_earned: 0,
      created_at: new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()
    };
    if (db.isAvailable()) {
      await db.query(
        `INSERT INTO flight_runs (id, user_id, game_id, distance, max_altitude, score, coins_earned, items_used, flight_script, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, '[]', '[]', $8)`,
        [
          run.id,
          run.user_id,
          run.game_id,
          run.distance,
          run.max_altitude,
          run.score,
          0,
          run.created_at
        ]
      );
    } else {
      store.flightRuns.push(run);
    }
  }
  const voos = async (periodo) =>
    (await LeaderboardService.getLeaderboard(50, 'void_walker', periodo)).find(
      (p) => p.username === user.username
    )?.total_flights;
  assert.equal(await voos('weekly'), 1);
  assert.equal(await voos('monthly'), 2);
  assert.equal(await voos('all'), 3);
});

// As salas 'user_<id>' recebem saldo de carteira e confirmação de assinatura.
// Antes o servidor entrava em qualquer sala pedida pelo cliente, então bastava
// saber o id de outra pessoa para ouvir os eventos privados dela.
test('join-room: sala publica e livre', () => {
  assert.equal(podeEntrarNaSala(null, 'stream_room'), true);
  assert.equal(podeEntrarNaSala({ id: 'u1' }, 'stream_room'), true);
});

test('join-room: usuario entra apenas na propria sala privada', () => {
  assert.equal(podeEntrarNaSala({ id: 'u1' }, 'user_u1'), true);
  assert.equal(podeEntrarNaSala({ id: 'u1' }, 'user_u2'), false);
});

test('join-room: socket anonimo nao entra em sala privada', () => {
  assert.equal(podeEntrarNaSala(null, 'user_u1'), false);
  assert.equal(podeEntrarNaSala({}, 'user_undefined'), false);
});

test('join-room: nomes invalidos ou inesperados sao recusados', () => {
  for (const sala of ['', 'admin', 'user_', null, undefined, 42, {}]) {
    assert.equal(podeEntrarNaSala({ id: 'u1' }, sala), false, `deveria recusar: ${String(sala)}`);
  }
});
