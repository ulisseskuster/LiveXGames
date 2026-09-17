// Suíte do InMemoryStore (IDs fictícios, fixtures direto na memória): roda
// sem banco mesmo quando o ambiente define DATABASE_URL, como no CI. Antes ela
// só passava ali porque gravava antes de o pool conectar.
process.env.DATABASE_URL = '';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const NotificationModel = require('../src/models/notificationModel');
const InMemoryStore = require('../src/data/store');

// Sem DATABASE_URL a suíte roda inteira sobre o InMemoryStore, que espelha a
// semântica das queries do model. (Mesmo caminho dos demais testes.)

const USUARIO = '11111111-1111-1111-1111-111111111111';
const OUTRO = '22222222-2222-2222-2222-222222222222';
const ENDPOINT = 'https://push.example.com/device-abc';

function inscricao(over = {}) {
  return {
    userId: USUARIO,
    endpoint: `https://push.example.com/${Math.random().toString(36).slice(2)}`,
    keysAuth: 'auth-key',
    keysP256dh: 'p256dh-key',
    userAgent: 'test-browser',
    ...over
  };
}

beforeEach(() => {
  InMemoryStore.pushSubscriptions.length = 0;
  InMemoryStore.notifications.length = 0;
});

test('upsertSubscription salva uma inscrição nova', async () => {
  const r = await NotificationModel.upsertSubscription(inscricao({ endpoint: ENDPOINT }));

  assert.ok(r.id);
  const lista = await NotificationModel.subscriptionsForUser(USUARIO);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].endpoint, ENDPOINT);
});

test('mesmo endpoint renova a inscrição, não duplica', async () => {
  const a = await NotificationModel.upsertSubscription(inscricao({ endpoint: ENDPOINT }));
  const b = await NotificationModel.upsertSubscription(
    inscricao({ endpoint: ENDPOINT, keysP256dh: 'nova-chave' })
  );

  assert.equal(a.id, b.id, 'é a MESMA inscrição, só renovada');
  const lista = await NotificationModel.subscriptionsForUser(USUARIO);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].keys_p256dh, 'nova-chave');
});

test('inscrição inválida é recusada', async () => {
  await assert.rejects(
    () => NotificationModel.upsertSubscription({ userId: USUARIO, endpoint: ENDPOINT }),
    /INVALID_SUBSCRIPTION/
  );
});

test('deleteSubscription remove só o endpoint pedido', async () => {
  const a = await NotificationModel.upsertSubscription(inscricao());
  const b = await NotificationModel.upsertSubscription(inscricao());

  const removida = await NotificationModel.deleteSubscription(a.endpoint, USUARIO);
  assert.ok(removida);

  const restantes = await NotificationModel.subscriptionsForUser(USUARIO);
  assert.equal(restantes.length, 1);
  assert.equal(restantes[0].endpoint, b.endpoint);
});

test('deleteSubscription de endpoint inexistente devolve null', async () => {
  assert.equal(
    await NotificationModel.deleteSubscription('https://none.example.com/x', USUARIO),
    null
  );
});

test('createNotification entra na fila como não lida e não entregue', async () => {
  const n = await NotificationModel.createNotification({
    userId: USUARIO,
    title: 'Brinde aprovado',
    body: 'Sua camiseta saiu da moderação.',
    url: '/loja',
    relatedType: 'reward',
    relatedId: 'rew-1'
  });

  assert.equal(n.read_at, null);
  assert.equal(n.delivered_at, null);
  assert.equal(await NotificationModel.countUnread(USUARIO), 1);
});

test('notificações são do usuário: não vazam entre contas', async () => {
  await NotificationModel.createNotification({ userId: USUARIO, title: 'Sua', body: 'x' });
  await NotificationModel.createNotification({ userId: OUTRO, title: 'De outro', body: 'y' });

  const minhas = await NotificationModel.listForUser(USUARIO);
  assert.equal(minhas.length, 1);
  assert.equal(minhas[0].title, 'Sua');
});

test('listForUser devolve mais recentes primeiro, com paginação', async () => {
  for (let i = 0; i < 5; i++) {
    await NotificationModel.createNotification({ userId: USUARIO, title: `N ${i}`, body: 'x' });
  }
  const pagina1 = await NotificationModel.listForUser(USUARIO, { limit: 2, offset: 0 });
  const pagina2 = await NotificationModel.listForUser(USUARIO, { limit: 2, offset: 2 });

  assert.equal(pagina1.length, 2);
  assert.equal(pagina1[0].title, 'N 4', 'a mais recente vem primeiro');
  assert.equal(pagina2[0].title, 'N 2');
});

test('markRead só funciona na notificação do próprio usuário', async () => {
  const minha = await NotificationModel.createNotification({
    userId: USUARIO,
    title: 'a',
    body: 'x'
  });
  const alheia = await NotificationModel.createNotification({
    userId: OUTRO,
    title: 'b',
    body: 'y'
  });

  assert.equal(await NotificationModel.markRead(USUARIO, alheia.id), null, 'não mexe na do outro');
  const marcada = await NotificationModel.markRead(USUARIO, minha.id);
  assert.ok(marcada);
  assert.equal(await NotificationModel.countUnread(USUARIO), 0);
});

test('markAllRead zera o contador', async () => {
  await NotificationModel.createNotification({ userId: USUARIO, title: 'a', body: 'x' });
  await NotificationModel.createNotification({ userId: USUARIO, title: 'b', body: 'y' });

  const mudadas = await NotificationModel.markAllRead(USUARIO);
  assert.equal(mudadas, 2);
  assert.equal(await NotificationModel.countUnread(USUARIO), 0);
});

test('limit é limitado a 50 e offset negativo vira 0', async () => {
  for (let i = 0; i < 60; i++) {
    await NotificationModel.createNotification({ userId: USUARIO, title: `N ${i}`, body: 'x' });
  }
  const lista = await NotificationModel.listForUser(USUARIO, { limit: 999, offset: -1 });
  assert.equal(lista.length, 50);
});
