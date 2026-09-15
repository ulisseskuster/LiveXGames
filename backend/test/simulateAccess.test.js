const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../src/server');
const UserModel = require('../src/models/userModel');
const AuthService = require('../src/services/authService');

const NIGHTPILOT_ID = '33333333-3333-3333-3333-333333333333';
const unico = () => Date.now().toString().slice(-8) + Math.floor(Math.random() * 999);

// Mesma proteção do sessionRevocation: com DATABASE_URL, o pool conecta de
// forma assíncrona e o create podia cair no InMemoryStore antes do ping inicial
// terminar, deixando um id que o findById (com o banco já disponível) não acha.
const dbReady = require('../src/config/database').whenReady();

// O Centro de Simulação & Testes credita moedas pela rota /api/payments/simulate.
// Como é uma fonte de moeda, ela vale como fronteira de confiança: esconder o
// painel no frontend não impede um POST direto. A checagem anterior valia só
// quando NODE_ENV === 'production', deixando qualquer viewer autenticado emitir
// moedas nos demais ambientes.
async function subirServidor() {
  const servidor = app.listen(0);
  await new Promise((resolve) => servidor.once('listening', resolve));
  const { port } = servidor.address();
  return { servidor, url: `http://127.0.0.1:${port}` };
}

async function tokenPara(role) {
  await dbReady;
  const id = unico();
  const user = await UserModel.create({
    username: `sim_${role}_${id}`,
    email: `sim_${role}_${id}@test.com`,
    password: 'demo123Password',
    role
  });
  return AuthService.generateToken(user);
}

async function simular(url, token) {
  return fetch(`${url}/api/payments/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ amount: 10, message: 'teste', streamerId: NIGHTPILOT_ID })
  });
}

test('simulate: viewer autenticado nao pode emitir moedas', async (t) => {
  const { servidor, url } = await subirServidor();
  t.after(() => servidor.close());

  const res = await simular(url, await tokenPara('viewer'));
  assert.equal(res.status, 403, 'viewer deve receber 403 em qualquer ambiente');
});

test('simulate: requisicao sem token e rejeitada', async (t) => {
  const { servidor, url } = await subirServidor();
  t.after(() => servidor.close());

  const res = await fetch(`${url}/api/payments/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 10, streamerId: NIGHTPILOT_ID })
  });
  assert.equal(res.status, 401);
});

test('simulate: streamer autenticado continua autorizado', async (t) => {
  const { servidor, url } = await subirServidor();
  t.after(() => servidor.close());

  const res = await simular(url, await tokenPara('streamer'));
  assert.notEqual(res.status, 403, 'streamer nao pode ser bloqueado pelo requireRole');
  assert.notEqual(res.status, 401);
});

test('simulate: admin continua autorizado', async (t) => {
  const { servidor, url } = await subirServidor();
  t.after(() => servidor.close());

  const res = await simular(url, await tokenPara('admin'));
  assert.notEqual(res.status, 403);
  assert.notEqual(res.status, 401);
});
