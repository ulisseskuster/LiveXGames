// @ts-check
const test = require('node:test');
const assert = require('node:assert/strict');
const PushNotificationService = require('../src/services/pushNotificationService');
const UserModel = require('../src/models/userModel');
const InMemoryStore = require('../src/data/store');

const unico = () => Date.now().toString().slice(-8) + Math.floor(Math.random() * 999);

// Sem VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY (padrão do ambiente de teste), o envio
// real não acontece, mas a notificação é SEMPRE gravada na fila e o serviço
// nunca falha o fluxo chamador (conquistas/doações seguem mesmo com push off).
test('WebPush: sem VAPID grava na fila e retorna skipped, sem lançar', async () => {
  const user = await UserModel.create({
    username: `push_${unico()}`,
    email: `push_${unico()}@test.com`,
    password: 'demo123Password',
    role: 'viewer'
  });

  const antes = InMemoryStore.notifications.length;
  const res = await PushNotificationService.sendToUser({
    userId: user.id,
    title: '🏆 Teste',
    body: 'Conquista desbloqueada',
    url: '/perfil',
    relatedType: 'achievement',
    relatedId: 'first_flight'
  });

  assert.equal(res.skipped, 'vapid', 'sem chaves VAPID deve retornar skipped=vapid');
  assert.ok(res.notification, 'deve devolver a notificação gravada');
  assert.equal(
    InMemoryStore.notifications.length,
    antes + 1,
    'notificação deve ser gravada na fila mesmo sem push'
  );
  assert.equal(res.notification.title, '🏆 Teste');
  assert.equal(res.notification.related_type, 'achievement');
});

test('WebPush: sem inscrições configuradas não quebra (0 enviadas, notificação gravada)', async () => {
  const user = await UserModel.create({
    username: `push2_${unico()}`,
    email: `push2_${unico()}@test.com`,
    password: 'demo123Password',
    role: 'viewer'
  });

  const res = await PushNotificationService.sendToUser({
    userId: user.id,
    title: 'Sem inscrição',
    body: 'Nada enviado'
  });

  assert.equal(res.skipped, 'vapid');
  assert.ok(res.notification);
});
