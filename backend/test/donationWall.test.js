const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');

const DonationWallService = require('../src/services/donationWallService');
const DonationModel = require('../src/models/donationModel');
const InMemoryStore = require('../src/data/store');

// Sem DATABASE_URL a suíte roda inteira sobre o InMemoryStore, que espelha a
// semântica das queries do model. É o mesmo caminho usado pelos demais testes.

const STREAMER = '33333333-3333-3333-3333-333333333333';
const OUTRO_STREAMER = '99999999-9999-9999-9999-999999999999';
const DOADOR = '11111111-1111-1111-1111-111111111111';
const VIEWER_A = '22222222-2222-2222-2222-222222222222';
const VIEWER_B = '55555555-5555-5555-5555-555555555555';

function criarDoacao({
  streamerId = STREAMER,
  userId = DOADOR,
  message = 'Manda um salve pra galera!',
  amountCents = 5000,
  createdAt = new Date().toISOString(),
  hidden = false
} = {}) {
  const donation = {
    id: randomUUID(),
    user_id: userId,
    provider: 'livepix',
    external_id: `ext-${randomUUID()}`,
    amount_cents: amountCents,
    coins_credited: 0,
    streamer_id: streamerId,
    status: 'completed',
    hidden_from_wall: hidden,
    metadata: { message, username: 'Fulano' },
    created_at: createdAt
  };
  InMemoryStore.donations.push(donation);
  return donation;
}

beforeEach(() => {
  InMemoryStore.donations.length = 0;
  InMemoryStore.donationReactions.length = 0;
  InMemoryStore.streamerPaymentConfigs.length = 0;
});

test('like em doação sem reação registra o voto e devolve myReaction', async () => {
  const d = criarDoacao();
  const r = await DonationWallService.react({
    streamerId: STREAMER,
    donationId: d.id,
    userId: VIEWER_A,
    type: 'like'
  });

  assert.equal(r.likesCount, 1);
  assert.equal(r.dislikesCount, 0);
  assert.equal(r.myReaction, 'like');
});

test('like duas vezes é toggle: a reação some, não vira duas', async () => {
  const d = criarDoacao();
  const args = { streamerId: STREAMER, donationId: d.id, userId: VIEWER_A, type: 'like' };

  await DonationWallService.react(args);
  const r = await DonationWallService.react(args);

  assert.equal(r.likesCount, 0);
  assert.equal(r.myReaction, null);
});

test('like seguido de dislike TROCA de lado: 0 e 1, nunca 1 e 1', async () => {
  const d = criarDoacao();
  const base = { streamerId: STREAMER, donationId: d.id, userId: VIEWER_A };

  await DonationWallService.react({ ...base, type: 'like' });
  const r = await DonationWallService.react({ ...base, type: 'dislike' });

  assert.equal(r.likesCount, 0, 'o like anterior tem de sumir');
  assert.equal(r.dislikesCount, 1);
  assert.equal(r.myReaction, 'dislike');
});

test('dois usuários distintos somam na mesma doação', async () => {
  const d = criarDoacao();
  await DonationWallService.react({
    streamerId: STREAMER,
    donationId: d.id,
    userId: VIEWER_A,
    type: 'like'
  });
  const r = await DonationWallService.react({
    streamerId: STREAMER,
    donationId: d.id,
    userId: VIEWER_B,
    type: 'like'
  });

  assert.equal(r.likesCount, 2);
});

test('reagir à própria doação é recusado', async () => {
  const d = criarDoacao({ userId: VIEWER_A });

  await assert.rejects(
    () =>
      DonationWallService.react({
        streamerId: STREAMER,
        donationId: d.id,
        userId: VIEWER_A,
        type: 'like'
      }),
    /CANNOT_REACT_OWN_DONATION/
  );
});

test('tipo de reação fora da allowlist é recusado', async () => {
  const d = criarDoacao();

  await assert.rejects(
    () =>
      DonationWallService.react({
        streamerId: STREAMER,
        donationId: d.id,
        userId: VIEWER_A,
        type: 'love'
      }),
    /INVALID_REACTION_TYPE/
  );
});

test('doação de outro canal responde como inexistente', async () => {
  const d = criarDoacao({ streamerId: OUTRO_STREAMER });

  await assert.rejects(
    () =>
      DonationWallService.react({
        streamerId: STREAMER,
        donationId: d.id,
        userId: VIEWER_A,
        type: 'like'
      }),
    /DONATION_NOT_FOUND/
  );
});

test('sort malicioso cai no padrão recent, sem executar nada', async () => {
  criarDoacao({ message: 'antiga', createdAt: new Date(Date.now() - 60 * 1000).toISOString() });
  criarDoacao({ message: 'nova' });

  const { items } = await DonationWallService.listWall(STREAMER, {
    sort: "'; DROP TABLE donations--"
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].message, 'nova', 'padrão recent: a mais nova vem primeiro');
});

test('doação oculta não aparece no feed', async () => {
  criarDoacao({ message: 'visível' });
  criarDoacao({ message: 'removida pelo streamer', hidden: true });

  const { items } = await DonationWallService.listWall(STREAMER, {});

  assert.equal(items.length, 1);
  assert.equal(items[0].message, 'visível');
});

test('doação sem mensagem não entra no mural', async () => {
  criarDoacao({ message: 'com texto' });
  criarDoacao({ message: '' });

  const { items } = await DonationWallService.listWall(STREAMER, {});

  assert.equal(items.length, 1);
});

test('ranking semanal ignora doação de 8 dias atrás', async () => {
  const oitoDias = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  criarDoacao({ message: 'desta semana' });
  criarDoacao({ message: 'da semana passada', createdAt: oitoDias });

  const semanal = await DonationWallService.listWall(STREAMER, { period: 'weekly' });
  const total = await DonationWallService.listWall(STREAMER, { period: 'all' });

  assert.equal(semanal.items.length, 1);
  assert.equal(semanal.items[0].message, 'desta semana');
  assert.equal(total.items.length, 2);
});

test('ranking por likes ordena pelas mais amadas', async () => {
  const fria = criarDoacao({ message: 'fria' });
  const amada = criarDoacao({ message: 'amada' });

  await DonationWallService.react({
    streamerId: STREAMER,
    donationId: amada.id,
    userId: VIEWER_A,
    type: 'like'
  });
  await DonationWallService.react({
    streamerId: STREAMER,
    donationId: amada.id,
    userId: VIEWER_B,
    type: 'like'
  });
  await DonationWallService.react({
    streamerId: STREAMER,
    donationId: fria.id,
    userId: VIEWER_A,
    type: 'like'
  });

  const { items } = await DonationWallService.listWall(STREAMER, { sort: 'likes' });

  assert.equal(items[0].message, 'amada');
  assert.equal(items[0].likesCount, 2);
});

test('maiores doadores somam por doador e respeitam período, canal e anonimato', async () => {
  const oitoDias = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  criarDoacao({ userId: DOADOR, amountCents: 1000 });
  // Sem mensagem e ocultada do mural também conta: o ranking é do dinheiro doado.
  criarDoacao({ userId: DOADOR, amountCents: 2500, message: '', hidden: true });
  criarDoacao({ userId: VIEWER_A, amountCents: 3000 });
  criarDoacao({ userId: VIEWER_A, amountCents: 5000, createdAt: oitoDias });
  criarDoacao({ userId: VIEWER_B, amountCents: 99900, streamerId: OUTRO_STREAMER });
  // Doação sem nome: o livepixService grava 'Anônimo', que não pode virar um doador.
  const anonima = criarDoacao({ userId: null, amountCents: 88800 });
  anonima.metadata.username = 'Anônimo';

  const semana = await DonationWallService.topDonors(STREAMER, { period: 'weekly' });
  assert.deepEqual(
    semana.map((d) => [d.totalBrl, d.donationsCount]),
    [
      [35, 2],
      [30, 1]
    ]
  );

  const sempre = await DonationWallService.topDonors(STREAMER, { period: 'all' });
  assert.deepEqual(
    sempre.map((d) => d.totalBrl),
    [80, 35]
  );
  assert.ok(sempre.every((d) => d.donor.username && !('id' in d.donor)));
});

test('limit é limitado a 50 e offset negativo vira 0', async () => {
  assert.equal(DonationWallService.sanitizeLimit(100000), 50);
  assert.equal(DonationWallService.sanitizeLimit('abc'), 50);
  assert.equal(DonationWallService.sanitizeLimit(10), 10);
  assert.equal(DonationWallService.sanitizeOffset(-5), 0);
  assert.equal(DonationWallService.sanitizeOffset('7'), 7);
});

test('hasMore indica próxima página sem contar a tabela inteira', async () => {
  for (let i = 0; i < 4; i++) criarDoacao({ message: `msg ${i}` });

  const pagina1 = await DonationWallService.listWall(STREAMER, { limit: 2, offset: 0 });
  const pagina2 = await DonationWallService.listWall(STREAMER, { limit: 2, offset: 2 });

  assert.equal(pagina1.items.length, 2);
  assert.equal(pagina1.hasMore, true);
  assert.equal(pagina2.items.length, 2);
  assert.equal(pagina2.hasMore, false);
});

test('doação sem doador vinculado vira Apoiador Anônimo, não null', async () => {
  criarDoacao({ userId: null });

  const { items } = await DonationWallService.listWall(STREAMER, {});

  assert.equal(items[0].donor.anonymous, true);
  assert.ok(items[0].donor.username, 'nunca pode cair vazio na tela');
});

test('myReaction reflete o viewer que pergunta, não o último a votar', async () => {
  const d = criarDoacao();
  await DonationWallService.react({
    streamerId: STREAMER,
    donationId: d.id,
    userId: VIEWER_A,
    type: 'like'
  });

  const doA = await DonationWallService.listWall(STREAMER, { viewerId: VIEWER_A });
  const doB = await DonationWallService.listWall(STREAMER, { viewerId: VIEWER_B });
  const deslogado = await DonationWallService.listWall(STREAMER, {});

  assert.equal(doA.items[0].myReaction, 'like');
  assert.equal(doB.items[0].myReaction, null);
  assert.equal(deslogado.items[0].myReaction, null);
});

test('só o dono do canal (ou admin) remove do mural, e é soft delete', async () => {
  const d = criarDoacao();

  await assert.rejects(
    () =>
      DonationWallService.hideFromWall({
        streamerId: STREAMER,
        donationId: d.id,
        requester: { id: OUTRO_STREAMER, role: 'streamer' }
      }),
    /NOT_CHANNEL_OWNER/,
    'outro streamer não pode moderar mural alheio'
  );

  await DonationWallService.hideFromWall({
    streamerId: STREAMER,
    donationId: d.id,
    requester: { id: STREAMER, role: 'streamer' }
  });

  const { items } = await DonationWallService.listWall(STREAMER, {});
  assert.equal(items.length, 0, 'sai do mural');

  const noBanco = await DonationModel.findById(d.id);
  assert.ok(noBanco, 'a doação continua no banco: é registro financeiro');
  assert.equal(noBanco.hidden_from_wall, true);
});

test('kill-switch do canal fecha o mural para leitura e para reação', async () => {
  const d = criarDoacao();
  InMemoryStore.streamerPaymentConfigs.push({
    id: randomUUID(),
    streamer_id: STREAMER,
    wall_enabled: false
  });

  await assert.rejects(() => DonationWallService.listWall(STREAMER, {}), /WALL_DISABLED/);
  await assert.rejects(
    () =>
      DonationWallService.react({
        streamerId: STREAMER,
        donationId: d.id,
        userId: VIEWER_A,
        type: 'like'
      }),
    /WALL_DISABLED/
  );
});
