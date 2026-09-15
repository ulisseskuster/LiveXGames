const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const KickService = require('../src/services/kickService');
const AuthService = require('../src/services/authService');
const UserModel = require('../src/models/userModel');
const InMemoryStore = require('../src/data/store');

test.before(() => {
  InMemoryStore.seedDemoViewer();
});

test('KickService: generatePkcePair produz code_verifier e code_challenge S256 válidos (RFC 7636)', () => {
  const { codeVerifier, codeChallenge } = KickService.generatePkcePair();

  assert.ok(
    codeVerifier.length >= 43 && codeVerifier.length <= 128,
    'verifier dentro do range RFC 7636'
  );
  assert.match(codeVerifier, /^[A-Za-z0-9_-]+$/, 'verifier deve ser base64url sem padding');

  const expectedChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  assert.equal(
    codeChallenge,
    expectedChallenge,
    'challenge deve ser SHA256(verifier) em base64url'
  );
});

test('KickService: getAuthorizationUrl inclui code_challenge_method=S256 e escopo user:read', () => {
  const url = KickService.getAuthorizationUrl('meu-state', 'challenge-abc');
  const parsed = new URL(url);

  assert.equal(parsed.origin, 'https://id.kick.com');
  assert.equal(parsed.pathname, '/oauth/authorize');
  assert.equal(parsed.searchParams.get('code_challenge'), 'challenge-abc');
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(parsed.searchParams.get('state'), 'meu-state');
  assert.equal(parsed.searchParams.get('scope'), 'user:read');
});

test('KickService: verifyWebhookSignature aceita assinatura RSA válida e rejeita payload adulterado', async () => {
  // Gera um par de chaves de teste local (não é a chave real da Kick) só
  // para validar a lógica de verificação RSA-SHA256/PKCS#1 v1.5.
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const originalGetKey = KickService.getWebhookPublicKey;
  KickService.getWebhookPublicKey = async () => publicKey;

  try {
    const messageId = 'msg-123';
    // Timestamp do momento: a verificação passou a exigir que o evento esteja
    // dentro da janela de 5 minutos, então uma data fixa envelhece e o teste
    // passaria a falhar sozinho. A rejeição por idade tem caso próprio abaixo.
    const timestamp = new Date().toISOString();
    const rawBody = JSON.stringify({ hello: 'world' });
    const signedPayload = `${messageId}.${timestamp}.${rawBody}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signedPayload);
    signer.end();
    const signature = signer.sign(privateKey).toString('base64');

    const validResult = await KickService.verifyWebhookSignature(
      messageId,
      timestamp,
      rawBody,
      signature
    );
    assert.equal(validResult, true, 'assinatura válida deve ser aceita');

    const tamperedResult = await KickService.verifyWebhookSignature(
      messageId,
      timestamp,
      JSON.stringify({ hello: 'tampered' }),
      signature
    );
    assert.equal(tamperedResult, false, 'corpo adulterado deve invalidar a assinatura');

    const wrongSigResult = await KickService.verifyWebhookSignature(
      messageId,
      timestamp,
      rawBody,
      Buffer.from('assinatura-invalida').toString('base64')
    );
    assert.equal(wrongSigResult, false, 'assinatura malformada nao deve derrubar o processo');

    // Replay: assinatura legítima, corpo intacto, evento velho. Sem a janela de
    // validade um webhook capturado uma vez valia para sempre.
    const antigoTimestamp = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const signerAntigo = crypto.createSign('RSA-SHA256');
    signerAntigo.update(`${messageId}.${antigoTimestamp}.${rawBody}`);
    signerAntigo.end();

    const replayResult = await KickService.verifyWebhookSignature(
      messageId,
      antigoTimestamp,
      rawBody,
      signerAntigo.sign(privateKey).toString('base64')
    );
    assert.equal(replayResult, false, 'evento fora da janela de 5 minutos deve ser recusado');
  } finally {
    KickService.getWebhookPublicKey = originalGetKey;
  }
});

test('KickService: processSubscriptionEvent promove espectador vinculado a subscriber com vidas douradas', async () => {
  const streamerUsername = `streamer_kick_${Date.now()}`;
  const viewerUsername = `viewer_kick_${Date.now()}`;

  await AuthService.register({
    name: 'Streamer Kick',
    phone: '11999990000',
    username: streamerUsername,
    email: `${streamerUsername}@example.com`,
    password: 'senha123456',
    birthDate: '1990-05-20',
    acceptedTerms: true
  });
  const streamerUser = await UserModel.findByUsername(streamerUsername);
  await UserModel.linkStreamAccount(streamerUser.id, {
    provider: 'kick',
    accountId: '999888777',
    accountUsername: `${streamerUsername}_kick`,
    isSubscriber: false
  });

  const viewerReg = await AuthService.register({
    name: 'Viewer Kick',
    phone: '11999991111',
    username: viewerUsername,
    email: `${viewerUsername}@example.com`,
    password: 'senha123456',
    birthDate: '1990-05-20',
    acceptedTerms: true
  });
  await UserModel.linkStreamAccount(viewerReg.user.id, {
    provider: 'kick',
    accountId: '111222333',
    accountUsername: `${viewerUsername}_kick`,
    isSubscriber: false
  });

  const result = await KickService.processSubscriptionEvent('channel.subscription.new', {
    broadcaster: { user_id: 999888777, username: `${streamerUsername}_kick` },
    subscriber: { user_id: 111222333, username: `${viewerUsername}_kick` }
  });

  assert.equal(result.applied, true);

  const updatedViewer = await UserModel.findById(viewerReg.user.id);
  assert.equal(updatedViewer.is_sub_kick, true);
  assert.equal(updatedViewer.role, 'subscriber');
  assert.equal(updatedViewer.max_lives, 3);
  assert.equal(UserModel.getSubLives(updatedViewer), 2);
});

test('KickService: processSubscriptionEvent ignora evento de streamer nao cadastrado na plataforma', async () => {
  const result = await KickService.processSubscriptionEvent('channel.subscription.new', {
    broadcaster: { user_id: 555000111 },
    subscriber: { user_id: 555000222 }
  });

  assert.equal(result.applied, false);
  assert.equal(result.reason, 'STREAMER_NOT_FOUND');
});
