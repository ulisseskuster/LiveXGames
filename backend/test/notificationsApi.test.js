// Suíte do InMemoryStore (como notifications.test.js, gameRuns.test.js etc.):
// força o store em memória MESMO quando DATABASE_URL está configurada no CI.
// Precisa vir ANTES de qualquer require do app/servidor: o database.js lê o
// env no momento do require e o pool/connection check já nascem decididos.
// O caminho Postgres real de notificações é coberto por seus próprios testes
// de integração; aqui o foco é o fluxo HTTP inteiro via listen(0) + fetch,
// determinístico, sem depender de seed/estado de banco externo.
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

test('fluxo HTTP completo de notificações: subscribe, listar, ler, unsubscribe', async (t) => {
  const { servidor, url } = await subirServidor();
  t.after(() => servidor.close());

  // 1. Login como viewer_alpha
  const loginRes = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'viewer_alpha', password: 'demo123' })
  });
  assert.equal(loginRes.status, 200, 'login da persona demo deve funcionar');

  const cookies = loginRes.headers.getSetCookie();
  const sessao = cookies.find((c) => c.startsWith(SESSION_COOKIE));
  assert.ok(sessao, 'cookie de sessão emitido');
  const cookieHeader = sessao.split(';')[0];

  const authHeaders = { 'Content-Type': 'application/json', Cookie: cookieHeader };

  // 2. Inscrever push (endpoint fake)
  const subRes = await fetch(`${url}/api/notifications/push/subscribe`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      endpoint: 'https://push.example.com/integration-test',
      keys: { auth: 'auth-key', p256dh: 'p256dh-key' }
    })
  });
  const subBody = await subRes.json();
  assert.equal(subRes.status, 200);
  assert.ok(subBody.data.id, 'inscrição criada');

  // 3. Criar notificação direto no modelo e listar via API
  const NotificationModel = require('../src/models/notificationModel');
  await NotificationModel.createNotification({
    userId: '11111111-1111-1111-1111-111111111111',
    title: 'Teste',
    body: 'Notificação de integração',
    url: '/'
  });

  const listaRes = await fetch(`${url}/api/notifications`, { headers: authHeaders });
  const listaBody = await listaRes.json();
  assert.equal(listaRes.status, 200);
  assert.equal(listaBody.data.items.length, 1);
  assert.equal(listaBody.data.unread, 1);

  // 4. Contar não lidas
  const unreadRes = await fetch(`${url}/api/notifications/unread-count`, {
    headers: authHeaders
  });
  const unreadBody = await unreadRes.json();
  assert.equal(unreadBody.data.unread, 1);

  // 5. Marcar como lida
  const notifId = listaBody.data.items[0].id;
  const readRes = await fetch(`${url}/api/notifications/${notifId}/read`, {
    method: 'POST',
    headers: authHeaders
  });
  assert.equal(readRes.status, 200);
  const unread2 = await (
    await fetch(`${url}/api/notifications/unread-count`, { headers: authHeaders })
  ).json();
  assert.equal(unread2.data.unread, 0);

  // 6. Unsubscribe
  const unsubRes = await fetch(`${url}/api/notifications/push/unsubscribe`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ endpoint: 'https://push.example.com/integration-test' })
  });
  assert.equal(unsubRes.status, 200);
  assert.equal(unsubRes.ok, true);

  // Um usuário não pode desativar a inscrição de outro, mesmo conhecendo a URL.
  const otherUser = '22222222-2222-2222-2222-222222222222';
  const otherEndpoint = 'https://push.example.com/other-user';
  await NotificationModel.upsertSubscription({
    userId: otherUser,
    endpoint: otherEndpoint,
    keysAuth: 'auth-key',
    keysP256dh: 'p256dh-key'
  });
  const otherUnsub = await fetch(`${url}/api/notifications/push/unsubscribe`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ endpoint: otherEndpoint })
  });
  assert.equal((await otherUnsub.json()).data.removed, false);
  assert.equal((await NotificationModel.subscriptionsForUser(otherUser)).length, 1);
});

test('subscribe exige autenticação (401 sem cookie)', async (t) => {
  const { servidor, url } = await subirServidor();
  t.after(() => servidor.close());

  const res = await fetch(`${url}/api/notifications/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'x', keys: { auth: 'a', p256dh: 'b' } })
  });
  assert.equal(res.status, 401);
});

test('subscribe valida payload: recusa sem keys.p256dh', async (t) => {
  const { servidor, url } = await subirServidor();
  t.after(() => servidor.close());

  const loginRes = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'viewer_alpha', password: 'demo123' })
  });
  const cookies = loginRes.headers.getSetCookie();
  const cookieHeader = cookies.find((c) => c.startsWith(SESSION_COOKIE)).split(';')[0];

  const res = await fetch(`${url}/api/notifications/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    body: JSON.stringify({ endpoint: 'https://push.example.com/x', keys: { auth: 'a' } })
  });
  assert.equal(res.status, 400);
});
