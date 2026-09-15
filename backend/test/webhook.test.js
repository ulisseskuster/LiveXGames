const test = require('node:test');
const assert = require('node:assert/strict');
const LivePixService = require('../src/services/livepixService');
const StreamerWalletModel = require('../src/models/streamerWalletModel');
const UserModel = require('../src/models/userModel');

const STREAMER_ID = '33333333-3333-3333-3333-333333333333';

test('LivePixService: deve processar doação e converter em Fichas de Apoio do streamer', async () => {
  const testUser = await UserModel.create({
    username: `donor_${Date.now()}`,
    email: `donor_${Date.now()}@test.com`,
    password: 'demoPassword123',
    role: 'viewer'
  });

  const walletBefore = await StreamerWalletModel.findByUserAndStreamer(testUser.id, STREAMER_ID);
  const initialBalance = Number(walletBefore.balance);
  const externalId = `ext-${Date.now()}-1`;

  const payload = {
    external_id: externalId,
    userId: testUser.id,
    amount: 15.0, // R$ 15,00
    message: 'Vai com tudo na live!'
  };

  const result = await LivePixService.processWebhook(payload, null, 'livepix', STREAMER_ID);

  assert.equal(result.idempotent, false);
  assert.ok(result.donation);
  assert.equal(result.donation.external_id, externalId);

  // R$ 15,00 * 100 = 1500 fichas adicionadas
  const walletAfter = await StreamerWalletModel.findByUserAndStreamer(testUser.id, STREAMER_ID);
  assert.equal(Number(walletAfter.balance), initialBalance + 1500);
});

test('LivePixService: sem streamerId deve ser rejeitado', async () => {
  const payload = {
    external_id: `ext-nostreamer-${Date.now()}`,
    amount: 5.0
  };

  await assert.rejects(async () => LivePixService.processWebhook(payload), /MISSING_STREAMER_ID/);
});

test('LivePixService: streamerId inexistente deve ser rejeitado', async () => {
  const payload = {
    external_id: `ext-badstreamer-${Date.now()}`,
    amount: 5.0
  };

  await assert.rejects(
    async () =>
      LivePixService.processWebhook(
        payload,
        null,
        'livepix',
        '99999999-9999-9999-9999-999999999999'
      ),
    /STREAMER_NOT_FOUND/
  );
});

test('LivePixService: idempotência - reenvio do mesmo external_id não deve duplicar fichas', async () => {
  const testUser = await UserModel.create({
    username: `idempotent_user_${Date.now()}`,
    email: `idempotent_user_${Date.now()}@test.com`,
    password: 'demoPassword123',
    role: 'viewer'
  });

  const externalId = `ext-idempotent-${Date.now()}`;
  const payload = {
    external_id: externalId,
    userId: testUser.id,
    amount: 20.0, // R$ 20,00 -> 2000 fichas
    message: 'Primeira chamada'
  };

  // Primeira execução: processada normalmente
  const firstRes = await LivePixService.processWebhook(payload, null, 'livepix', STREAMER_ID);
  assert.equal(firstRes.idempotent, false);

  const walletAfterFirst = await StreamerWalletModel.findByUserAndStreamer(
    testUser.id,
    STREAMER_ID
  );

  // Segunda execução: detecta duplicação e garante idempotência
  const secondRes = await LivePixService.processWebhook(payload, null, 'livepix', STREAMER_ID);
  assert.equal(secondRes.idempotent, true);

  const walletAfterSecond = await StreamerWalletModel.findByUserAndStreamer(
    testUser.id,
    STREAMER_ID
  );
  assert.equal(
    Number(walletAfterSecond.balance),
    Number(walletAfterFirst.balance),
    'Saldo não deve ser duplicado!'
  );
});

test('LivePixService: generateSignature deve produzir HMAC SHA256 válido', () => {
  const payload = { test: 123 };
  const signature = LivePixService.generateSignature(payload);

  assert.ok(signature);
  assert.equal(typeof signature, 'string');
  assert.equal(signature.length, 64, 'HMAC SHA256 hex possui 64 caracteres');
});

test('LivePixService: PixGG webhook deve creditar fichas com provider "pixgg"', async () => {
  const testUser = await UserModel.create({
    username: `pixgg_donor_${Date.now()}`,
    email: `pixgg_donor_${Date.now()}@test.com`,
    password: 'demoPassword123',
    role: 'viewer'
  });

  const walletBefore = await StreamerWalletModel.findByUserAndStreamer(testUser.id, STREAMER_ID);
  const initialBalance = Number(walletBefore.balance);
  const externalId = `pixgg-${Date.now()}`;

  const payload = {
    provider: 'pixgg',
    external_id: externalId,
    userId: testUser.id,
    amount: 25.0, // R$ 25,00 -> 2.500 fichas
    message: 'Apoio via PixGG!'
  };

  const result = await LivePixService.processWebhook(payload, null, 'pixgg', STREAMER_ID);

  assert.equal(result.idempotent, false);
  assert.equal(result.donation.provider, 'pixgg');
  assert.equal(result.coinsCredited, 2500);

  const walletAfter = await StreamerWalletModel.findByUserAndStreamer(testUser.id, STREAMER_ID);
  assert.equal(Number(walletAfter.balance), initialBalance + 2500);
});

test('LivePixService: Subscritor deve receber bônus de +10% em fichas nas doações', async () => {
  const subUser = await UserModel.create({
    username: `sub_donor_${Date.now()}`,
    email: `sub_donor_${Date.now()}@test.com`,
    password: 'demoPassword123',
    role: 'subscriber'
  });

  const walletBefore = await StreamerWalletModel.findByUserAndStreamer(subUser.id, STREAMER_ID);
  const initialBalance = Number(walletBefore.balance);
  const externalId = `sub-bonus-${Date.now()}`;

  const payload = {
    provider: 'livepix',
    external_id: externalId,
    userId: subUser.id,
    amount: 10.0, // R$ 10,00 -> base 1.000 + 10% (100) = 1.100 fichas
    message: 'Apoio com bônus de sub!'
  };

  const result = await LivePixService.processWebhook(payload, null, 'livepix', STREAMER_ID);

  assert.equal(result.coinsCredited, 1100);
  assert.equal(result.subBonusCoins, 100);

  const walletAfter = await StreamerWalletModel.findByUserAndStreamer(subUser.id, STREAMER_ID);
  assert.equal(Number(walletAfter.balance), initialBalance + 1100);
});

test('LivePixService: deve identificar usuário a partir de menção na mensagem da doação', async () => {
  const uniqueNick = `piloto_msg_${Date.now()}`;
  const targetUser = await UserModel.create({
    username: uniqueNick,
    email: `${uniqueNick}@test.com`,
    password: 'demoPassword123',
    role: 'viewer'
  });

  const walletBefore = await StreamerWalletModel.findByUserAndStreamer(targetUser.id, STREAMER_ID);
  const initialBalance = Number(walletBefore.balance);
  const externalId = `msg-detect-${Date.now()}`;

  // Payload sem userId ou username direto, mas com o nick na mensagem
  const payload = {
    external_id: externalId,
    amount: 5.0,
    message: `Mandando um salve para o piloto @${uniqueNick} voar alto!`
  };

  const result = await LivePixService.processWebhook(payload, null, 'livepix', STREAMER_ID);
  assert.equal(result.donation.user_id, targetUser.id);

  const walletAfter = await StreamerWalletModel.findByUserAndStreamer(targetUser.id, STREAMER_ID);
  assert.equal(Number(walletAfter.balance), initialBalance + 500);
});
