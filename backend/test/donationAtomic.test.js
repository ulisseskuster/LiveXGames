// Fase 1 (P0-A): doação atômica e recuperável.
//
// Cobre o furo auditado: doação gravada como 'completed' ANTES do crédito na
// carteira. Com uma queda ou falha no meio, a reentrega do webhook era engolida
// pela idempotência e o saldo ficava 0 para sempre.
//
// Estes testes rodam SEM banco (InMemoryStore), então a transação real do
// Postgres não é exercitada aqui — eles verificam o comportamento do serviço:
// reentrega de doação pendente credita e nunca duplica; doação nova grava
// crédito junto; e a reconciliação recupera uma doação do fluxo antigo.
// Suíte do InMemoryStore (IDs fictícios, fixtures direto na memória): roda
// sem banco mesmo quando o ambiente define DATABASE_URL, como no CI. Antes ela
// só passava ali porque gravava antes de o pool conectar.
process.env.DATABASE_URL = '';

const test = require('node:test');
const assert = require('node:assert');

const LivePixService = require('../src/services/livepixService');
const StreamerWalletService = require('../src/services/streamerWalletService');
const DonationModel = require('../src/models/donationModel');
const InMemoryStore = require('../src/data/store');

const STREAMER_ID = '33333333-3333-3333-3333-333333333333'; // nightpilot
const VIEWER_ID = '11111111-1111-1111-1111-111111111111'; // viewer_alpha

async function saldoDoViewer() {
  const { balance } = await StreamerWalletService.getBalance(VIEWER_ID, STREAMER_ID);
  return Number(balance);
}

test('reentrega de doação pendente credita e não duplica', async () => {
  const externalId = `pend-${Date.now()}`;
  const antes = await saldoDoViewer();

  // Simula o estado do fluxo antigo: doação gravada, crédito nunca aplicado.
  const pendente = await DonationModel.create({
    userId: VIEWER_ID,
    provider: 'livepix',
    externalId,
    amountCents: 1000,
    coinsCredited: 1000,
    streamerId: STREAMER_ID,
    status: 'pending',
    metadata: { username: 'viewer_alpha', amountBrl: 10 }
  });
  assert.ok(pendente, 'doação pendente criada');

  // Primeira reentrega: deve creditar e marcar completed.
  const result = await LivePixService.tentarCreditarPendente(
    pendente,
    InMemoryStore.users.find((u) => u.id === VIEWER_ID),
    InMemoryStore.users.find((u) => u.id === STREAMER_ID),
    null
  );
  assert.equal(result.recovered, true, 'recuperada');
  assert.equal(result.success, true);
  assert.equal((await saldoDoViewer()) - antes, 1000, 'creditou 1000 moedas');

  // Segunda reentrega: idempotente, não credita de novo.
  const deNovo = await LivePixService.tentarCreditarPendente(
    { ...pendente, status: 'pending' },
    InMemoryStore.users.find((u) => u.id === VIEWER_ID),
    InMemoryStore.users.find((u) => u.id === STREAMER_ID),
    null
  );
  assert.equal(deNovo.idempotent, true, 'segunda recuperação é idempotente');
  assert.equal((await saldoDoViewer()) - antes, 1000, 'não creditou duas vezes');
});

test('doação nova em fluxo normal credita uma vez e não fica pendente', async () => {
  const externalId = `nova-${Date.now()}`;
  const antes = await saldoDoViewer();

  const resultado = await LivePixService.processWebhook(
    {
      provider: 'livepix',
      external_id: externalId,
      userId: VIEWER_ID,
      amount: 10,
      message: 'oi'
    },
    null,
    'livepix',
    STREAMER_ID
  );

  assert.equal(resultado.success, true);
  assert.equal((await saldoDoViewer()) - antes, 1000, 'credita R$10 = 1000 fichas');

  const donation = await DonationModel.findByExternalId(externalId);
  assert.equal(donation.status, 'completed', 'doação concluída');
  assert.ok(donation.credited_at, 'crédito carimbado');
});

test('reentrega do mesmo webhook após sucesso é idempotente (não duplica)', async () => {
  const externalId = `re-${Date.now()}`;
  const antes = await saldoDoViewer();

  const primeiro = await LivePixService.processWebhook(
    { provider: 'livepix', external_id: externalId, userId: VIEWER_ID, amount: 5 },
    null,
    'livepix',
    STREAMER_ID
  );
  assert.equal(primeiro.success, true);
  assert.equal((await saldoDoViewer()) - antes, 500);

  const segundo = await LivePixService.processWebhook(
    { provider: 'livepix', external_id: externalId, userId: VIEWER_ID, amount: 5 },
    null,
    'livepix',
    STREAMER_ID
  );
  assert.equal(segundo.idempotent, true, 'reentrega reconhecida');
  assert.equal((await saldoDoViewer()) - antes, 500, 'saldo não mudou');
});

test('reconciliação lista pendentes e recupera todas', async () => {
  InMemoryStore.donations.length = 0;

  const antes = await saldoDoViewer();
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const d = await DonationModel.create({
      userId: VIEWER_ID,
      provider: 'livepix',
      externalId: `rec-${Date.now()}-${i}`,
      amountCents: 200,
      coinsCredited: 200,
      streamerId: STREAMER_ID,
      status: 'pending',
      metadata: {}
    });
    ids.push(d.id);
  }

  const pendentes = await DonationModel.listarPendentes();
  assert.equal(pendentes.length, 3, 'lista 3 pendentes');

  for (const d of pendentes) {
    const r = await LivePixService.tentarCreditarPendente(
      d,
      InMemoryStore.users.find((u) => u.id === VIEWER_ID),
      InMemoryStore.users.find((u) => u.id === STREAMER_ID),
      null
    );
    assert.equal(r.recovered, true);
  }

  assert.equal((await saldoDoViewer()) - antes, 600, 'recuperou 3 × 200');
  assert.equal((await DonationModel.listarPendentes()).length, 0, 'nenhuma pendente restante');
});
