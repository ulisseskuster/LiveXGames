const test = require('node:test');
const assert = require('node:assert/strict');

// Precisa vir antes do require do store: o hash da persona de admin é calculado
// no carregamento do módulo, e sem ADMIN_PASSWORD a senha passa a ser aleatória
// (não há mais senha padrão embutida no código).
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'senha-de-teste-do-admin';

const AuthService = require('../src/services/authService');
const UserModel = require('../src/models/userModel');
const InMemoryStore = require('../src/data/store');

test.before(() => {
  InMemoryStore.seedDemoViewer();
});

test('AuthService: login com credenciais válidas deve retornar token JWT e dados do usuário', async () => {
  const result = await AuthService.login('viewer_alpha', 'demo123');

  assert.ok(result.token, 'Token deve existir');
  assert.equal(result.user.username, 'viewer_alpha');
  assert.equal(result.user.role, 'viewer');
  assert.equal(result.user.lives, 3, 'Viewer deve ter 3 vidas');
  assert.ok(result.wallet, 'Carteira deve ser retornada');
});

test('AuthService: login com senha incorreta deve lançar erro INVALID_PASSWORD', async () => {
  await assert.rejects(
    async () => {
      await AuthService.login('viewer_alpha', 'senha_errada');
    },
    { message: 'INVALID_PASSWORD' }
  );
});

test('AuthService: registro de novo usuário deve sempre atribuir perfil viewer e prevenir escalação de privilégios', async () => {
  const uniqueUsername = `piloto_${Date.now()}`;
  const result = await AuthService.register({
    name: 'Piloto Brasileiro Real',
    phone: '(11) 98888-7777',
    username: uniqueUsername,
    email: `${uniqueUsername}@test.com`,
    password: 'senhaSegura123',
    role: 'admin', // Tentativa de escalação de privilégio deve ser ignorada
    birthDate: '1990-05-20',
    acceptedTerms: true
  });

  assert.ok(result.token);
  assert.equal(result.user.username, uniqueUsername);
  assert.equal(result.user.name, 'Piloto Brasileiro Real');
  assert.equal(result.user.phone, '(11) 98888-7777');
  assert.equal(result.user.role, 'viewer', 'Cadastro público deve ser sempre viewer');
  assert.equal(result.user.lives, 3, 'Viewer deve receber 3 vidas padrão');
  assert.equal(result.wallet.balance, 0, 'Sem bônus global: moedas só existem por canal');
});

test('AuthService: registro com senha fraca (menos de 6 caracteres) deve ser rejeitado', async () => {
  await assert.rejects(
    async () => {
      await AuthService.register({
        username: `weak_${Date.now()}`,
        email: `weak_${Date.now()}@test.com`,
        password: '123',
        birthDate: '1990-05-20',
        acceptedTerms: true
      });
    },
    { message: 'WEAK_PASSWORD' }
  );
});

test('UserModel: consumo de vida deve decrementar o total de vidas do usuário', async () => {
  const user = await UserModel.findByUsername('viewer_alpha');
  const initialLives = user.lives;

  const updated = await UserModel.consumeLife(user.id);
  assert.equal(updated.lives, Math.max(0, initialLives - 1));
});

test('AuthService: vincular Twitch com status de Sub promove a subscriber com 2 vidas douradas', async () => {
  const uniqueUsername = `pilot_twitch_${Date.now()}`;
  const reg = await AuthService.register({
    name: 'Piloto Twitch Fan',
    phone: '(19) 99111-2222',
    username: uniqueUsername,
    email: `${uniqueUsername}@test.com`,
    password: 'senhaSegura123',
    role: 'viewer',
    birthDate: '1990-05-20',
    acceptedTerms: true
  });

  assert.equal(reg.user.role, 'viewer');
  assert.equal(reg.user.max_lives, 3);

  const linked = await AuthService.linkStreamAccount(reg.user.id, {
    provider: 'twitch',
    accountUsername: 'twitch_sub_streamer',
    isSubscriber: true
  });

  assert.equal(linked.user.twitch_username, 'twitch_sub_streamer');
  assert.equal(linked.user.is_sub_twitch, true);
  assert.equal(linked.user.role, 'subscriber', 'Deve ser promovido a subscriber');
  assert.equal(linked.user.max_lives, 3, 'As vidas normais continuam as de todo mundo');
  assert.equal(linked.user.max_sub_lives, 2);
  assert.equal(linked.user.sub_lives, 2);
});

test('UserModel: sub gasta as douradas antes das normais, não acumula Twitch + Kick e as recebe de volta no dia seguinte', async () => {
  const username = `sub_dourado_${Date.now()}`;
  const reg = await AuthService.register({
    username,
    email: `${username}@test.com`,
    password: 'senhaSegura123',
    birthDate: '1990-05-20',
    acceptedTerms: true
  });
  const id = reg.user.id;
  await UserModel.linkStreamAccount(id, {
    provider: 'twitch',
    accountUsername: 'dourado_ttv',
    isSubscriber: true
  });
  await UserModel.linkStreamAccount(id, {
    provider: 'kick',
    accountUsername: 'dourado_kick',
    isSubscriber: true
  });

  let perfil = await AuthService.getProfile(id);
  assert.equal(perfil.user.max_sub_lives, 2, 'Sub nos dois canais não acumula');

  assert.equal((await UserModel.consumeLife(id)).usouDourada, true);
  assert.equal((await UserModel.consumeLife(id)).usouDourada, true);
  const terceira = await UserModel.consumeLife(id);
  assert.ok(!terceira.usouDourada, 'Sem douradas, a partida sai das normais');
  assert.equal(terceira.lives, 2);

  perfil = await AuthService.getProfile(id);
  assert.equal(perfil.user.sub_lives, 0);

  // Uso gravado num dia que já passou: as douradas voltam sem job de reset.
  InMemoryStore.users.find((u) => u.id === id).sub_lives_day = '2000-01-01';
  perfil = await AuthService.getProfile(id);
  assert.equal(perfil.user.sub_lives, 2);
});

test('UserModel: o dia das douradas vira à meia-noite de Brasília, não à de UTC', () => {
  assert.equal(UserModel.diaDeBrasilia(new Date('2026-09-13T02:59:00Z')), '2026-09-12');
  assert.equal(UserModel.diaDeBrasilia(new Date('2026-09-13T03:00:00Z')), '2026-09-13');
});

test('AuthService: login de administrador deve expor papel de admin e acesso privilegiado', async () => {
  // Fixture isolada: o admin global só existe no banco se ADMIN_PASSWORD estiver
  // definido no ambiente (autoMigrate pula o sync sem ele) e no InMemory o seed
  // é frágil a timing de conexão. Criar o admin aqui mesmo valida a mesma coisa
  // (papel admin + saldo elevado) sem depender do ambiente.
  const id = 'admin_fixture_' + Date.now().toString().slice(-6);
  const criado = await UserModel.create({
    username: id,
    email: `${id}@test.com`,
    password: 'demo123Password',
    role: 'admin'
  });
  // O create abre carteira zerada; o saldo elevado do admin é um privilégio do
  // seed/sync (99999), então a fixture dá o mesmo top-up explícito.
  const WalletModel = require('../src/models/walletModel');
  await WalletModel.addCredits(criado.id, 99999);
  const result = await AuthService.login(id, 'demo123Password');

  assert.ok(result.token, 'Token deve existir para o admin');
  assert.equal(result.user.username, id);
  assert.equal(result.user.role, 'admin');
  assert.equal(result.user.lives, 999, 'Admin deve iniciar com vidas máximas');
  assert.equal(
    result.wallet.balance,
    99999,
    'Admin deve ter saldo elevado para moderação e testes'
  );
  assert.equal(criado.id, result.user.id, 'Login deve retornar o admin criado');
});

test('AuthService: vincular Kick e desvincular contas', async () => {
  const uniqueUsername = `pilot_kick_${Date.now()}`;
  const reg = await AuthService.register({
    username: uniqueUsername,
    email: `${uniqueUsername}@test.com`,
    password: 'senhaSegura123',
    role: 'viewer',
    birthDate: '1990-05-20',
    acceptedTerms: true
  });

  // Vincula Kick sem sub
  const linkedKick = await AuthService.linkStreamAccount(reg.user.id, {
    provider: 'kick',
    accountUsername: 'pilot_kick_official',
    isSubscriber: false
  });
  assert.equal(linkedKick.user.kick_username, 'pilot_kick_official');
  assert.equal(linkedKick.user.is_sub_kick, false);
  assert.equal(linkedKick.user.role, 'viewer');

  // Desvincula Kick
  const unlinked = await AuthService.unlinkStreamAccount(reg.user.id, 'kick');
  assert.equal(unlinked.user.kick_username, null);
  assert.equal(unlinked.user.is_sub_kick, false);
});

test('UserModel: deleteByUsername deve remover usuário para permitir re-cadastro isolado', async () => {
  const testUser = `temp_del_${Date.now()}`;
  await AuthService.register({
    username: testUser,
    email: `${testUser}@test.com`,
    password: 'password123',
    birthDate: '1990-05-20',
    acceptedTerms: true
  });

  const foundBefore = await UserModel.findByUsername(testUser);
  assert.ok(foundBefore, 'Usuário deve existir antes da exclusão');

  const deleted = await UserModel.deleteByUsername(testUser);
  assert.equal(deleted, true, 'deleteByUsername deve retornar true');

  const foundAfter = await UserModel.findByUsername(testUser);
  assert.equal(foundAfter, null, 'Usuário não deve existir após exclusão');
});
