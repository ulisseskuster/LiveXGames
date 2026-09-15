// Suíte do InMemoryStore (como streak.test.js e demais): força o store em
// memória mesmo quando DATABASE_URL está configurada no CI. Precisa vir ANTES
// de qualquer require do app/servidor (o database.js captura o env no require).
process.env.DATABASE_URL = '';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../src/server');
const { SESSION_COOKIE } = require('../src/config/session');

async function subirServidor() {
  const servidor = app.listen(0);
  await new Promise((resolve) => servidor.once('listening', resolve));
  return { servidor, url: `http://127.0.0.1:${servidor.address().port}` };
}

test('GET /api/auth/me inclui streak no response', async (t) => {
  const { servidor, url } = await subirServidor();
  t.after(() => servidor.close());

  // Login como viewer_alpha
  const loginRes = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'viewer_alpha', password: 'demo123' })
  });
  assert.equal(loginRes.status, 200);
  const cookieHeader = loginRes.headers
    .getSetCookie()
    .find((c) => c.startsWith(SESSION_COOKIE))
    .split(';')[0];

  const meRes = await fetch(`${url}/api/auth/me`, { headers: { Cookie: cookieHeader } });
  const meBody = await meRes.json();
  assert.equal(meRes.status, 200);
  assert.ok(meBody.data.streak !== undefined, '/me deve incluir campo streak');
  assert.ok(typeof meBody.data.streak.current === 'number');
  assert.ok(typeof meBody.data.streak.best === 'number');
});

test('GET /api/auth/me com streak funcionando com InMemoryStore', async (t) => {
  const { servidor, url } = await subirServidor();
  t.after(() => servidor.close());

  const loginRes = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'viewer_alpha', password: 'demo123' })
  });
  const cookieHeader = loginRes.headers
    .getSetCookie()
    .find((c) => c.startsWith(SESSION_COOKIE))
    .split(';')[0];

  // Streak inicial
  const me1 = await (
    await fetch(`${url}/api/auth/me`, { headers: { Cookie: cookieHeader } })
  ).json();
  assert.equal(me1.data.streak.current, 0, 'sem atividade: streak 0');
});
