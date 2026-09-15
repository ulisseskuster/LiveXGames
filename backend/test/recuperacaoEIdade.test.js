// Cadastro com aceite de termos e idade mínima, e recuperação de senha por
// e-mail. Antes disto, quem esquecia a senha perdia a conta (o sistema não
// enviava e-mail nenhum) e ninguém precisava aceitar nada para se cadastrar.
const test = require('node:test');
const assert = require('node:assert');

const AuthService = require('../src/services/authService');
const AuthTokenModel = require('../src/models/authTokenModel');
const UserModel = require('../src/models/userModel');

const unico = () => Date.now().toString().slice(-9) + Math.floor(Math.random() * 1000);

function dataComIdade(anos) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - anos);
  return d.toISOString().slice(0, 10);
}

function cadastroValido(extra = {}) {
  const id = unico();
  return {
    username: `piloto_${id}`,
    email: `piloto_${id}@example.com`,
    password: 'senhaSegura123',
    birthDate: dataComIdade(25),
    acceptedTerms: true,
    ...extra
  };
}

/* ------------------------------------------------------ aceite e idade */

test('cadastro sem aceite dos Termos é recusado', async () => {
  await assert.rejects(
    () => AuthService.register(cadastroValido({ acceptedTerms: false })),
    (err) => err.message === 'TERMS_NOT_ACCEPTED'
  );
});

test('aceite não pode ser forjado com um valor que não seja true', async () => {
  // Um `if (acceptedTerms)` aceitaria a string 'false', que é verdadeira em JS.
  for (const valor of ['false', 'sim', 1, {}]) {
    await assert.rejects(
      () => AuthService.register(cadastroValido({ acceptedTerms: valor })),
      (err) => err.message === 'TERMS_NOT_ACCEPTED',
      `acceptedTerms: ${JSON.stringify(valor)} não pode passar`
    );
  }
});

test('menor de 18 anos é recusado, inclusive na véspera do aniversário', async () => {
  await assert.rejects(
    () => AuthService.register(cadastroValido({ birthDate: dataComIdade(15) })),
    (err) => err.message === 'UNDERAGE'
  );

  // Faz 18 amanhã: hoje ainda tem 17.
  const amanha = new Date();
  amanha.setFullYear(amanha.getFullYear() - 18);
  amanha.setDate(amanha.getDate() + 1);
  await assert.rejects(
    () => AuthService.register(cadastroValido({ birthDate: amanha.toISOString().slice(0, 10) })),
    (err) => err.message === 'UNDERAGE',
    'quem completa 18 amanhã ainda não pode entrar'
  );
});

test('data de nascimento ausente, malformada ou no futuro é recusada', async () => {
  const futuro = new Date();
  futuro.setFullYear(futuro.getFullYear() + 1);

  for (const valor of [null, '', '20/05/1990', '1990-13-45', futuro.toISOString().slice(0, 10)]) {
    await assert.rejects(
      () => AuthService.register(cadastroValido({ birthDate: valor })),
      (err) => ['INVALID_BIRTH_DATE', 'UNDERAGE'].includes(err.message),
      `birthDate: ${JSON.stringify(valor)} não pode passar`
    );
  }
});

test('cadastro válido grava o aceite com data e versão', async () => {
  const dados = cadastroValido();
  const resultado = await AuthService.register(dados);

  assert.equal(resultado.user.terms_accepted, true, 'o perfil deve refletir o aceite');
  assert.equal(resultado.user.email_verified, false, 'e-mail começa sem confirmação');

  const gravado = await UserModel.findByUsername(dados.username);
  assert.ok(gravado.terms_accepted_at, 'a hora do aceite é a prova de consentimento');
  assert.ok(gravado.terms_version, 'a versão dos termos aceitos precisa ficar registrada');
  assert.ok(gravado.birth_date, 'a data de nascimento precisa ficar gravada');
});

/* --------------------------------------------- recuperação de senha */

test('pedido de redefinição responde igual para conta existente e inexistente', async () => {
  const dados = cadastroValido();
  await AuthService.register(dados);

  const existente = await AuthService.requestPasswordReset(dados.username);
  const inexistente = await AuthService.requestPasswordReset('nao_existe_' + unico());

  // Diferenciar as respostas transformaria a rota num verificador de cadastro.
  assert.deepEqual(existente, inexistente);
});

test('o link de redefinição troca a senha e só funciona uma vez', async () => {
  const dados = cadastroValido();
  const { user } = await AuthService.register(dados);

  const token = await AuthTokenModel.criar('password_reset', {
    userId: user.id,
    ttlMs: 60 * 60 * 1000
  });

  await AuthService.resetPassword(token, 'novaSenhaForte456');

  const comNova = await AuthService.login(dados.username, 'novaSenhaForte456');
  assert.ok(comNova.token, 'a senha nova deve funcionar');

  await assert.rejects(
    () => AuthService.login(dados.username, dados.password),
    (err) => err.message === 'INVALID_PASSWORD',
    'a senha antiga deve parar de valer'
  );

  await assert.rejects(
    () => AuthService.resetPassword(token, 'maisOutraSenha789'),
    (err) => err.message === 'INVALID_OR_EXPIRED_TOKEN',
    'o mesmo link não pode redefinir duas vezes'
  );
});

test('token expirado não redefine senha', async () => {
  const { user } = await AuthService.register(cadastroValido());
  const token = await AuthTokenModel.criar('password_reset', { userId: user.id, ttlMs: -1000 });

  await assert.rejects(
    () => AuthService.resetPassword(token, 'senhaQualquer123'),
    (err) => err.message === 'INVALID_OR_EXPIRED_TOKEN'
  );
});

test('pedir um link novo invalida o anterior', async () => {
  const { user } = await AuthService.register(cadastroValido());
  const antigo = await AuthTokenModel.criar('password_reset', {
    userId: user.id,
    ttlMs: 60 * 60 * 1000
  });
  await AuthTokenModel.criar('password_reset', { userId: user.id, ttlMs: 60 * 60 * 1000 });

  // Senão, um e-mail antigo interceptado continuaria abrindo a conta.
  await assert.rejects(
    () => AuthService.resetPassword(antigo, 'senhaQualquer123'),
    (err) => err.message === 'INVALID_OR_EXPIRED_TOKEN'
  );
});

test('a redefinição recusa senha fraca antes de consumir o token', async () => {
  const { user } = await AuthService.register(cadastroValido());
  const token = await AuthTokenModel.criar('password_reset', {
    userId: user.id,
    ttlMs: 60 * 60 * 1000
  });

  await assert.rejects(
    () => AuthService.resetPassword(token, '123'),
    (err) => err.message === 'WEAK_PASSWORD'
  );

  // O token tem de sobreviver: gastar a única chance por causa de um erro de
  // digitação obrigaria o usuário a pedir tudo de novo.
  await AuthService.resetPassword(token, 'agoraSimUmaSenha123');
});

/* ------------------------------------------ confirmação de e-mail */

test('o link de confirmação marca o e-mail como verificado, uma vez só', async () => {
  const dados = cadastroValido();
  const { user } = await AuthService.register(dados);

  const token = await AuthTokenModel.criar('email_verification', {
    userId: user.id,
    ttlMs: 48 * 60 * 60 * 1000,
    email: dados.email
  });

  await AuthService.verifyEmail(token);

  const depois = await UserModel.findById(user.id);
  assert.ok(depois.email_verified_at, 'a confirmação precisa ficar gravada');

  await assert.rejects(
    () => AuthService.verifyEmail(token),
    (err) => err.message === 'INVALID_OR_EXPIRED_TOKEN'
  );
});

test('o link de redefinição não serve como link de confirmação', async () => {
  const { user } = await AuthService.register(cadastroValido());
  const tokenDeSenha = await AuthTokenModel.criar('password_reset', {
    userId: user.id,
    ttlMs: 60 * 60 * 1000
  });

  // Os dois tipos vivem em tabelas separadas. Se um valesse pelo outro, um link
  // de confirmação vazado viraria uma troca de senha.
  await assert.rejects(
    () => AuthService.verifyEmail(tokenDeSenha),
    (err) => err.message === 'INVALID_OR_EXPIRED_TOKEN'
  );
});
