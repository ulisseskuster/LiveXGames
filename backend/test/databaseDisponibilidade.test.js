// Estado de conexão do banco (AUDITORIA.md A1): uma conexão ociosa derrubada
// pelo servidor não pode deixar a instância "desconectada" para sempre — em
// produção isso virava /health 503 com o banco saudável, e fora dela desviava
// escritas para o InMemoryStore.
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/database');

const semBanco = !db.isConfigured() && 'sem DATABASE_URL: não há pool para derrubar';

test('com banco configurado, os models nunca caem na memória', { skip: semBanco }, () => {
  assert.equal(db.isAvailable(), true);
});

test(
  'conexão ociosa encerrada pelo servidor não deixa o banco marcado como fora',
  { skip: semBanco },
  async () => {
    await db.whenReady();
    assert.equal(db.isConnected(), true);

    // Duas conexões simultâneas: a primeira volta ociosa ao pool e é encerrada
    // pelo servidor através da segunda (como num restart ou failover).
    const [vitima, carrasco] = [await db.connect(), await db.connect()];
    const { rows } = await vitima.query('SELECT pg_backend_pid() AS pid');
    vitima.release();
    await carrasco.query('SELECT pg_terminate_backend($1)', [rows[0].pid]);
    carrasco.release();
    await new Promise((resolve) => setTimeout(resolve, 500));

    await db.query('SELECT 1');
    assert.equal(db.isConnected(), true);
  }
);
