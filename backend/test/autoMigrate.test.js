const test = require('node:test');
const assert = require('node:assert/strict');
const { seedPersona } = require('../src/db/autoMigrate');

// Cria um client PostgreSQL falso que responde à consulta de conflito de
// identidade com as linhas fornecidas.
function fakeClient(conflictRows = []) {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: conflictRows };
    }
  };
}

const persona = {
  id: '33333333-3333-3333-3333-333333333333',
  username: 'nightpilot',
  email: 'nightpilot@example.com',
  label: 'nightpilot'
};

test('seedPersona: insere a persona quando o username/e-mail estão livres', async () => {
  const client = fakeClient([]);
  let executou = false;

  const aplicada = await seedPersona(client, {
    ...persona,
    run: async () => {
      executou = true;
    }
  });

  assert.equal(aplicada, true);
  assert.equal(executou, true, 'O INSERT da persona deve rodar quando não há conflito');
});

test('seedPersona: pula a persona quando o username já pertence a uma conta real (users_username_key)', async () => {
  // Cenário real de produção: alguém se cadastrou pelo site com o username de
  // uma persona; recebeu um UUID novo, então não colide no id — colide no
  // UNIQUE de username, que o ON CONFLICT (id) dos seeds não cobre.
  const client = fakeClient([
    { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', username: 'nightpilot', email: 'real@user.com' }
  ]);
  let executou = false;

  const aplicada = await seedPersona(client, {
    ...persona,
    run: async () => {
      executou = true;
    }
  });

  assert.equal(aplicada, false);
  assert.equal(executou, false, 'A conta real do usuário nunca pode ser sobrescrita pelo seed');
});

test('seedPersona: falha em uma persona não propaga e não derruba a automigração', async () => {
  const client = fakeClient([]);

  const aplicada = await seedPersona(client, {
    ...persona,
    run: async () => {
      throw new Error('duplicate key value violates unique constraint "users_username_key"');
    }
  });

  assert.equal(aplicada, false, 'Erro na persona deve ser contido, permitindo as demais seguirem');
});
