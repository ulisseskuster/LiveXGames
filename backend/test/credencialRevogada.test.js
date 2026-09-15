// A migração 015 não apaga conta nenhuma: ela invalida o hash da senha que
// vazou. reward_redemptions.streamer_id e streamer_wallets.streamer_id apontam
// para users(id) com ON DELETE CASCADE, então apagar 'nightpilot' levaria junto
// todo resgate do canal — inclusive entrega física pendente de usuário real.
// O que vazou foi a credencial, e é ela que precisa morrer.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const AuthService = require('../src/services/authService');
const UserModel = require('../src/models/userModel');
const InMemoryStore = require('../src/data/store');

const MARCADOR = 'CREDENCIAL_REVOGADA';
const MIGRACAO = path.join(
  __dirname,
  '../../database/migrations/015_revoga_credenciais_expostas.sql'
);

test('a migração revoga credencial, nunca apaga conta', () => {
  const sql = fs.readFileSync(MIGRACAO, 'utf8');
  assert.match(sql, /UPDATE users\s+SET password_hash/, 'deve revogar via UPDATE');
  assert.doesNotMatch(
    sql,
    /DELETE\s+FROM\s+users/i,
    'apagar users cascateia em dados de terceiros'
  );
  assert.doesNotMatch(sql, /DROP\s+TABLE/i);
  for (const conta of [
    'viewer_alpha',
    'sub_beta',
    'nightpilot',
    'testsprite_user',
    'admin_livex'
  ]) {
    assert.ok(sql.includes(conta), `${conta} precisa estar na revogação`);
  }
  assert.ok(sql.includes(`password_hash <> '${MARCADOR}'`), 'reexecutar não deve reescrever à toa');
});

test('hash revogado recusa o login sem derrubar a conta', async () => {
  const alvo = InMemoryStore.users.find((u) => u.username === 'viewer_alpha');
  assert.ok(alvo, 'fixture de desenvolvimento precisa existir');
  const original = alvo.passwordHash;
  alvo.passwordHash = MARCADOR;

  try {
    // O marcador não é um hash bcrypt válido. bcrypt.compare devolve false para
    // hash malformado em vez de lançar, então a resposta é 401 e não 500.
    await assert.rejects(
      () => AuthService.login('viewer_alpha', 'demo123'),
      (err) => err.message === 'INVALID_PASSWORD',
      'a senha que vazou tem de ser recusada'
    );

    const aindaExiste = await UserModel.findByUsername('viewer_alpha');
    assert.ok(aindaExiste, 'a conta continua existindo');
    assert.equal(aindaExiste.id, alvo.id, 'mesmo id: nada foi recriado nem removido');
  } finally {
    alvo.passwordHash = original;
  }
});
