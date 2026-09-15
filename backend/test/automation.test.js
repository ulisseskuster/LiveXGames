const test = require('node:test');
const assert = require('node:assert/strict');
const { runAutoMigration } = require('../src/db/autoMigrate');
const ImageUploadService = require('../src/services/imageUploadService');
const TwitchService = require('../src/services/twitchService');
const UserModel = require('../src/models/userModel');
const StreamerChannelController = require('../src/controllers/streamerChannelController');

test('AutoMigrate: deve retornar erro seguro quando pool for nulo', async () => {
  const result = await runAutoMigration(null);
  assert.equal(result.success, false);
  assert.equal(result.error, 'NO_POOL');
});

test('ImageUploadService: sem Cloudinary configurado, retorna imagem original de forma transparente', async () => {
  const testUrl = 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518';
  const result = await ImageUploadService.uploadImage(testUrl);
  assert.equal(result, testUrl);
});

test('ImageUploadService: detecta e não reenvia URLs que já são da CDN Cloudinary', async () => {
  const cdnUrl = 'https://res.cloudinary.com/demo/image/upload/sample.jpg';
  const result = await ImageUploadService.uploadImage(cdnUrl);
  assert.equal(result, cdnUrl);
});

test('TwitchService: getAuthorizationUrl deve conter client_id válido, redirect_uri e scopes oficiais', () => {
  const url = TwitchService.getAuthorizationUrl('test_state');
  // Usa o client_id real configurado em .env quando presente (ambiente local do
  // desenvolvedor), caindo para o ID de demonstração apenas em CI/ambientes sem
  // credenciais — evita que o teste dependa de nunca haver um .env configurado.
  const expectedClientId = process.env.TWITCH_CLIENT_ID || 'kd1unb4gahabc4rr63680b7axtcf6u';
  assert.ok(url.startsWith('https://id.twitch.tv/oauth2/authorize'));
  assert.ok(url.includes('response_type=code'));
  assert.ok(url.includes('user%3Aread%3Asubscriptions'));
  assert.ok(url.includes(`client_id=${expectedClientId}`));
  assert.ok(url.includes('state=test_state'));
  assert.equal(TwitchService.getAuthEndpoint(), 'https://id.twitch.tv/oauth2/authorize');
});

test('AuthController: twitchCallback trata erros com postMessage para popup sem quebrar UI', async () => {
  const AuthController = require('../src/controllers/authController');
  let htmlOutput = '';
  const mockReq = {
    query: { error: 'access_denied', error_description: 'User canceled authorization' },
    headers: {}
  };
  const mockRes = {
    // O Express sempre popula res.locals; aqui ele carrega o nonce da CSP que o
    // middleware de server.js injeta em cada requisição.
    locals: { cspNonce: 'nonce-de-teste' },
    send: (content) => {
      htmlOutput = content;
      return mockRes;
    },
    redirect: (loc) => {
      htmlOutput = loc;
      return mockRes;
    }
  };

  await AuthController.twitchCallback(mockReq, mockRes);
  assert.ok(htmlOutput.includes('TWITCH_AUTH_ERROR'));
  assert.ok(
    htmlOutput.includes('<script nonce="nonce-de-teste">'),
    'O <script> da página de callback precisa do nonce, senão a CSP o bloqueia'
  );
  assert.ok(htmlOutput.includes('window.opener.postMessage'));
  assert.ok(htmlOutput.includes('User canceled authorization'));
});

test('TwitchService: getUserProfile em modo simulação retorna objeto com dados válidos', async () => {
  const profile = await TwitchService.getUserProfile('mock_access_token');
  assert.ok(profile.id);
  assert.ok(profile.login);
  assert.equal(typeof profile.login, 'string');
});

test('UserModel & StreamerChannel: updateStreamerSettings e consulta de canal', async () => {
  const nightpilot = await UserModel.findByUsername('nightpilot');
  assert.ok(nightpilot);

  const updated = await UserModel.updateStreamerSettings(nightpilot.id, {
    livepixUrl: 'custom_nightpilot',
    pixggUrl: 'custom_nightpilot_pixgg'
  });

  assert.equal(updated.livepix_url, 'custom_nightpilot');
  assert.equal(updated.pixgg_url, 'custom_nightpilot_pixgg');

  // Simula req e res para StreamerChannelController.getChannel
  let resData = null;
  let resStatus = 200;
  const mockReq = { params: { username: 'nightpilot' } };
  const mockRes = {
    status: (code) => {
      resStatus = code;
      return mockRes;
    },
    json: (payload) => {
      resData = payload;
      return mockRes;
    }
  };

  await StreamerChannelController.getChannel(mockReq, mockRes);
  assert.equal(resStatus, 200);
  assert.ok(resData.data);
  assert.equal(resData.data.username, 'nightpilot');
  assert.equal(resData.data.donation_links.livepix, 'https://livepix.gg/custom_nightpilot');
  assert.equal(resData.data.donation_links.pixgg, 'https://pix.gg/custom_nightpilot_pixgg');
});
