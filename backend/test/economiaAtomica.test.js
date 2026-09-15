// Regressões dos furos de emissão de moeda corrigidos na auditoria.
//
// Os três tinham a mesma forma: verificar antes, aplicar depois, sem nada
// serializando o meio. Cada teste aqui falha se a ordem voltar a se inverter.
const test = require('node:test');
const assert = require('node:assert');

const LivePixService = require('../src/services/livepixService');
const StreamerRouletteService = require('../src/services/streamerRouletteService');
const StreamerWalletService = require('../src/services/streamerWalletService');
const { createRateLimiter } = require('../src/middlewares/rateLimiter');
const InMemoryStore = require('../src/data/store');

const STREAMER_ID = '33333333-3333-3333-3333-333333333333'; // nightpilot
const VIEWER_ID = '11111111-1111-1111-1111-111111111111'; // viewer_alpha

async function saldoDoViewer() {
  const { balance } = await StreamerWalletService.getBalance(VIEWER_ID, STREAMER_ID);
  return Number(balance);
}

test('webhook de doação reentregue em paralelo credita uma vez só', async () => {
  const externalId = `dup-${Date.now()}`;
  const payload = {
    provider: 'livepix',
    external_id: externalId,
    userId: VIEWER_ID,
    amount: 10,
    message: 'Doação de teste'
  };

  const antes = await saldoDoViewer();

  // Quatro entregas simultâneas do MESMO external_id. Antes, todas passavam pela
  // consulta de idempotência antes de qualquer uma gravar, e o INSERT duplicado
  // era engolido por um catch que devolvia sucesso: creditava quatro vezes.
  const resultados = await Promise.all(
    [0, 1, 2, 3].map(() =>
      LivePixService.processWebhook({ ...payload }, null, 'livepix', STREAMER_ID)
    )
  );

  const processadas = resultados.filter((r) => r && r.idempotent !== true);
  assert.equal(processadas.length, 1, 'apenas uma entrega pode processar a doação');

  const creditado = (await saldoDoViewer()) - antes;
  assert.equal(creditado, 1000, 'R$ 10,00 = 1000 moedas, creditadas uma única vez');
});

test('giros simultâneos da roleta concedem um prêmio só', async () => {
  // Isola o dia: a checagem é por (user, streamer, data).
  InMemoryStore.streamerRouletteSpins.length = 0;

  const antes = await saldoDoViewer();
  const vidasAntes = (await StreamerWalletService.getBalance(VIEWER_ID, STREAMER_ID)).extraLives;
  const itensAntes = InMemoryStore.channelInventory.filter((i) => i.user_id === VIEWER_ID).length;

  const resultados = await Promise.allSettled(
    [0, 1, 2, 3, 4].map(() => StreamerRouletteService.spin(VIEWER_ID, STREAMER_ID))
  );

  const aceitos = resultados.filter((r) => r.status === 'fulfilled');
  assert.equal(aceitos.length, 1, 'só um giro por dia pode ser aceito');

  const recusados = resultados.filter((r) => r.status === 'rejected');
  assert.ok(
    recusados.every((r) => r.reason.message.startsWith('ALREADY_SPUN_TODAY')),
    'os demais devem ser recusados por já ter girado hoje'
  );

  // O prêmio do único giro aceito é de um tipo só — e nenhum dos recusados pode
  // ter deixado crédito para trás. Era esse o furo: o prêmio saía antes do
  // registro, então cada giro perdido ainda pagava.
  const premio = aceitos[0].value.prize;
  const ganhoMoedas = (await saldoDoViewer()) - antes;
  const ganhoVidas =
    (await StreamerWalletService.getBalance(VIEWER_ID, STREAMER_ID)).extraLives - vidasAntes;
  const ganhoItens = InMemoryStore.channelInventory.filter((i) => i.user_id === VIEWER_ID).length;

  if (premio.type === 'fichas') {
    assert.equal(ganhoMoedas, premio.amount, 'crédito igual ao prêmio de um único giro');
  } else {
    assert.equal(ganhoMoedas, 0, 'prêmio não-monetário não pode creditar moedas');
  }
  if (premio.type === 'extra_life') {
    assert.equal(ganhoVidas, 1, 'no máximo uma vida extra');
  } else {
    assert.equal(ganhoVidas, 0, 'só o prêmio de vida extra mexe nas vidas');
  }
  if (premio.type !== 'item') {
    assert.equal(ganhoItens, itensAntes, 'só o prêmio de item mexe no inventário');
  }
});

test('rate limiter ignora x-forwarded-for forjado e conta pelo IP real', () => {
  // O middleware é desligado sob NODE_ENV=test; aqui o objetivo é justamente
  // exercitá-lo.
  const ambiente = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  try {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, message: 'limite' });

    const chamar = (forwarded) => {
      let status = 200;
      const req = {
        // req.ip é o que o Express resolve com trust proxy; o cabeçalho cru é
        // escrito pelo cliente e é o que servia de chave antes.
        ip: '203.0.113.7',
        headers: { 'x-forwarded-for': forwarded },
        socket: { remoteAddress: '203.0.113.7' }
      };
      const res = {
        setHeader() {},
        status(code) {
          status = code;
          return this;
        },
        json() {
          return this;
        }
      };
      limiter(req, res, () => {});
      return status;
    };

    // Um cabeçalho diferente por requisição criava um bucket por requisição.
    assert.equal(chamar('1.1.1.1'), 200);
    assert.equal(chamar('2.2.2.2'), 200);
    assert.equal(chamar('3.3.3.3'), 429, 'o limite deve valer apesar do cabeçalho trocado');
    assert.equal(chamar('4.4.4.4'), 429);
  } finally {
    process.env.NODE_ENV = ambiente;
  }
});

// A Bateria de Vidas agora entrega vidas extras do canal (channelEconomy.test.js).
test('prêmio de vida passa do máximo e estorno não', async () => {
  const UserModel = require('../src/models/userModel');

  const viewer = InMemoryStore.users.find((u) => u.id === VIEWER_ID);
  viewer.lives = viewer.max_lives; // cheio

  // Roleta: "+1 Vida Extra" era escolhida enquanto lives < max_lives + 2, mas a
  // concessão clampava em max_lives — o giro do dia ia embora sem entregar nada.
  const depoisDoPremio = await UserModel.addExtraLife(VIEWER_ID, { acimaDoMaximo: true });
  assert.equal(depoisDoPremio.lives, viewer.max_lives + 1, 'vida extra deve passar do máximo');

  // Estorno de partida que não aconteceu continua com teto: devolve o que foi
  // debitado, não concede vida nova.
  viewer.lives = viewer.max_lives;
  const depoisDoEstorno = await UserModel.addExtraLife(VIEWER_ID);
  assert.equal(depoisDoEstorno.lives, viewer.max_lives, 'estorno não ultrapassa o máximo');
});
