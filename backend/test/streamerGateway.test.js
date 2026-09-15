const test = require('node:test');
const assert = require('node:assert/strict');
const StreamerPaymentConfigModel = require('../src/models/streamerPaymentConfigModel');
const StreamerGatewayService = require('../src/services/streamerGatewayService');
const LivePixService = require('../src/services/livepixService');
const StreamerWalletService = require('../src/services/streamerWalletService');
const UserModel = require('../src/models/userModel');

test('StreamerGateway: salvar e mascarar credenciais de API PixGG e LivePix', async () => {
  const streamerId = '33333333-3333-3333-3333-333333333333'; // nightpilot

  const updated = await StreamerPaymentConfigModel.updateApiCredentials(streamerId, {
    pixgg_client_id: 'app_test_pixgg_123',
    pixgg_client_secret: 'secret_test_pixgg_xyz987',
    livepix_client_id: 'livepix_test_id_456',
    livepix_client_secret: 'secret_test_livepix_abc654'
  });

  assert.equal(updated.pixgg_client_id, 'app_test_pixgg_123');
  assert.equal(updated.pixgg_client_secret, 'secret_test_pixgg_xyz987');
  assert.equal(updated.livepix_client_id, 'livepix_test_id_456');
  assert.equal(updated.livepix_client_secret, 'secret_test_livepix_abc654');

  const maskedPixgg = StreamerPaymentConfigModel.maskSecret(updated.pixgg_client_secret);
  assert.equal(maskedPixgg, 'secr••••z987');

  const maskedLivepix = StreamerPaymentConfigModel.maskSecret(updated.livepix_client_secret);
  assert.equal(maskedLivepix, 'secr••••c654');
});

test('StreamerGatewayService: setPixggWebhookUrl e setLivepixWebhookUrl em simulação', async () => {
  const pixggRes = await StreamerGatewayService.setPixggWebhookUrl(
    'test_pixgg_client',
    'test_pixgg_secret',
    'https://livexgames.dev/webhooks/pixgg/33333333-3333-3333-3333-333333333333'
  );
  assert.equal(pixggRes.success, true);
  assert.equal(pixggRes.simulation, true);

  const livepixRes = await StreamerGatewayService.setLivepixWebhookUrl(
    'test_livepix_client',
    'test_livepix_secret',
    'https://livexgames.dev/webhooks/livepix/33333333-3333-3333-3333-333333333333'
  );
  assert.equal(livepixRes.success, true);
  assert.equal(livepixRes.simulation, true);
});

test('LivePixService: processar webhook PixGG oficial com data.transactionPublicId e totalAmount', async () => {
  const streamerId = '33333333-3333-3333-3333-333333333333';
  const viewer = await UserModel.findByUsername('viewer_alpha');
  const initialWallet = await StreamerWalletService.getBalance(viewer.id, streamerId);

  const officialPixggPayload = {
    event: 'donation.paid',
    timestamp: new Date().toISOString(),
    provider: 'pixgg',
    data: {
      transactionPublicId: `trn_official_${Date.now()}`,
      streamerUsername: 'nightpilot',
      donatorUsername: 'viewer_alpha',
      message: 'Parabéns pela live!',
      totalAmount: 15, // R$ 15,00
      status: 'paid'
    }
  };

  const result = await LivePixService.processWebhook(
    officialPixggPayload,
    null,
    'pixgg',
    streamerId
  );
  assert.equal(result.success, true);
  assert.equal(result.fichasEarned, 1500); // R$ 15 * 100

  const updatedWallet = await StreamerWalletService.getBalance(viewer.id, streamerId);
  assert.equal(Number(updatedWallet.balance), Number(initialWallet.balance) + 1500);
});

test('LivePixService: processar webhook LivePix oficial { event: "new", resource: { id, type } }', async () => {
  const streamerId = '33333333-3333-3333-3333-333333333333';
  const viewer = await UserModel.findByUsername('viewer_alpha');
  const initialWallet = await StreamerWalletService.getBalance(viewer.id, streamerId);

  const officialLivepixPayload = {
    userId: 'test_livepix_user_id',
    clientId: 'test_livepix_client_id',
    event: 'new',
    provider: 'livepix',
    resource: {
      id: `livepix_res_${Date.now()}`,
      reference: 'ref_123',
      type: 'message'
    }
  };

  const result = await LivePixService.processWebhook(
    officialLivepixPayload,
    null,
    'livepix',
    streamerId
  );
  assert.equal(result.success, true);
  assert.equal(result.fichasEarned, 1000); // 10.0 * 100 (simulado)

  const updatedWallet = await StreamerWalletService.getBalance(viewer.id, streamerId);
  assert.equal(Number(updatedWallet.balance), Number(initialWallet.balance) + 1000);
});

test('StreamerGatewayService: verifyApi valida credenciais PixGG e LivePix', async () => {
  const missingRes = await StreamerGatewayService.verifyApi('pixgg', '', '');
  assert.equal(missingRes.valid, false);

  const pixggRes = await StreamerGatewayService.verifyApi(
    'pixgg',
    'app_pixgg_123',
    'secret_pixgg_456'
  );
  assert.equal(pixggRes.valid, true);
  assert.equal(pixggRes.provider, 'pixgg');

  const livepixRes = await StreamerGatewayService.verifyApi(
    'livepix',
    'test_client_id',
    'test_secret'
  );
  assert.equal(typeof livepixRes.valid, 'boolean');
});
