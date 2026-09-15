// @ts-check
const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../src/server');
const UserModel = require('../src/models/userModel');
const AuthService = require('../src/services/authService');

const unico = () => Date.now().toString().slice(-8) + Math.floor(Math.random() * 999);

// Se DATABASE_URL está definida, o pool conecta de forma assíncrona: quem cria
// dados como primeira ação do teste pode rodar antes do ping inicial terminar e
// cair silenciosamente no InMemoryStore, gerando um id que não existe na tabela
// real — o findById seguinte (agora com o banco disponível) devolve null e o
// /me responde 404. Aguardar o pool garante que create/findById usem o MESMO
// store (ver config/database.js).
const dbReady = require('../src/config/database').whenReady();

async function subirServidor() {
  const servidor = app.listen(0);
  await new Promise((resolve) => servidor.once('listening', resolve));
  const { port } = servidor.address();
  return { servidor, url: `http://127.0.0.1:${port}` };
}

async function criarUsuarioComToken() {
  await dbReady;
  const id = unico();
  const user = await UserModel.create({
    username: `rev_${id}`,
    email: `rev_${id}@test.com`,
    password: 'demo123Password',
    role: 'viewer'
  });
  const token = AuthService.generateToken(user);
  return { user, token };
}

// O logout revoga o token (P1 do ESCALA.md): o MESMO JWT que era válido passa
// a ser rejeitado depois de incrementar token_version — sem esperar expirar.
test('revogacao: token antigo e rejeitado apos logout (401)', async (t) => {
  const { servidor, url } = await subirServidor();
  t.after(() => servidor.close());

  const { user, token } = await criarUsuarioComToken();

  // Token válido antes da revogação
  let res = await fetch(`${url}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(res.status, 200, 'token recem-emitido deveria funcionar');

  // Revoga (simula o logout incrementando token_version)
  await UserModel.incrementarTokenVersion(user.id);

  // O MESMO token agora é rejeitado
  res = await fetch(`${url}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(res.status, 401, 'token antigo deve ser rejeitado apos revogacao');
});

test('revogacao: token novo apos a revogacao continua valido', async (t) => {
  const { servidor, url } = await subirServidor();
  t.after(() => servidor.close());

  const { user } = await criarUsuarioComToken();
  await UserModel.incrementarTokenVersion(user.id);

  // Novo login gera token com a versão nova → vale
  const userAtual = await UserModel.findById(user.id);
  const tokenNovo = AuthService.generateToken(userAtual);

  const res = await fetch(`${url}/api/auth/me`, {
    headers: { Authorization: `Bearer ${tokenNovo}` }
  });
  assert.equal(res.status, 200, 'token com a versao atual deve funcionar');
});
