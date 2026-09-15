// Em producao o InMemoryStore nao pode trazer conta nenhuma.
//
// Ele assume sempre que db.isAvailable() e falso -- inclusive quando
// DATABASE_URL esta configurada mas o banco nao respondeu no arranque, que e o
// "modo de resiliencia" anunciado em /status. Com as personas embutidas, uma
// queda do Postgres em producao abria um mundo paralelo onde 'nightpilot'
// (streamer), 'testsprite_user' (50.000 moedas) e 'viewer_alpha' entram com as
// senhas versionadas neste repositorio publico.
process.env.NODE_ENV = 'production';

const test = require('node:test');
const assert = require('node:assert');
const InMemoryStore = require('../src/data/store');

test('producao: InMemoryStore nao traz nenhuma persona de demonstracao', () => {
  assert.deepEqual(InMemoryStore.users, [], 'nenhuma conta pre-existente em producao');
  assert.deepEqual(InMemoryStore.wallets, [], 'nenhuma carteira pre-carregada');
  assert.deepEqual(InMemoryStore.streamerWallets, [], 'nenhum saldo de apoio pre-carregado');
  assert.deepEqual(InMemoryStore.inventory, [], 'nenhum item pre-concedido');
  assert.deepEqual(InMemoryStore.streamerRewards, [], 'nenhum brinde de exemplo');
});

test('producao: o catalogo da loja continua sendo servido', () => {
  // shop_items e conteudo real do produto, nao persona: sem ele a loja fica
  // vazia no modo sem banco, e o corte teria ido longe demais.
  assert.ok(InMemoryStore.shopItems.length > 0, 'catalogo de equipamentos deve existir');
});

test('nenhuma senha de demonstracao vale como login em producao', async () => {
  const UserModel = require('../src/models/userModel');

  for (const username of ['viewer_alpha', 'nightpilot', 'testsprite_user', 'sub_beta']) {
    await assert.rejects(
      () => UserModel.findByUsername(username),
      /SSL|PostgreSQL|connection|ECONNREFUSED/i,
      `${username} não deve consultar um fallback em memória em produção`
    );
  }
});
