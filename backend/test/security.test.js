const test = require('node:test');
const assert = require('node:assert/strict');
const GameRunService = require('../src/services/gameRunService');
const UserModel = require('../src/models/userModel');
const WalletModel = require('../src/models/walletModel');
const AuthService = require('../src/services/authService');
const StreamerRewardService = require('../src/services/streamerRewardService');
const PaymentController = require('../src/controllers/paymentController');
const StreamerChannelController = require('../src/controllers/streamerChannelController');
const PaymentService = require('../src/services/paymentService');

const NIGHTPILOT_ID = '33333333-3333-3333-3333-333333333333';
const unico = () => Date.now().toString().slice(-8) + Math.floor(Math.random() * 999);

test('PaymentController: doação deve usar sempre o usuário autenticado e rejeitar requisição anônima', async () => {
  const originalCreateDonationIntent = PaymentService.createDonationIntent;
  PaymentService.createDonationIntent = async ({ userId, amount, message }) => ({
    userId,
    amount,
    message,
    ok: true
  });

  try {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
        return this;
      }
    };

    await PaymentController.donate(
      {
        user: { id: 'user-123', username: 'viewer_ok' },
        body: { userId: 'attacker-999', amount: 25, message: 'mensagem' }
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.data.userId, 'user-123');

    const anonymousRes = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
        return this;
      }
    };

    await PaymentController.donate(
      {
        body: { userId: 'attacker-999', amount: 25, message: 'mensagem' }
      },
      anonymousRes
    );

    assert.equal(anonymousRes.statusCode, 401);
    assert.equal(anonymousRes.payload.message, 'Autenticação obrigatória para realizar uma doação');
  } finally {
    PaymentService.createDonationIntent = originalCreateDonationIntent;
  }
});

test('StreamerChannelController: URL pública de webhook não pode depender de Host do cliente em produção', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  delete process.env.PUBLIC_BASE_URL;
  process.env.NODE_ENV = 'production';

  try {
    assert.throws(
      () => StreamerChannelController.getPublicBaseUrl({ get: () => 'evil.example.com' }),
      /PUBLIC_BASE_URL/
    );
  } finally {
    if (previousPublicBaseUrl === undefined) {
      delete process.env.PUBLIC_BASE_URL;
    } else {
      process.env.PUBLIC_BASE_URL = previousPublicBaseUrl;
    }
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});

test('GameRunService: rodadas simultâneas não podem gastar a mesma vida duas vezes', async () => {
  await require('../src/config/database').whenReady();
  const id = unico();
  const user = await UserModel.create({
    username: `race_${id}`,
    email: `race_${id}@test.com`,
    password: 'demo123Password',
    role: 'viewer'
  });
  await WalletModel.addCredits(user.id, 100000, { type: 'admin_grant' });
  for (const item of ['nos_injection', 'emp_shield', 'drift_tires']) {
    await require('../src/models/channelInventoryModel').add(
      user.id,
      '33333333-3333-3333-3333-333333333333',
      item,
      5
    );
  }

  // Deixa exatamente 1 vida (viewer começa com 3)
  await UserModel.consumeLife(user.id);
  await UserModel.consumeLife(user.id);
  assert.equal((await UserModel.findById(user.id)).lives, 1, 'Pré-condição: 1 vida restante');

  // Os itens equipados ampliam a janela entre validar e debitar: são consultas de
  // catálogo e de rodadas pendentes antes do débito. Era numa janela assim que
  // vários lançamentos paralelos passavam todos pela checagem com a mesma vida.
  const equipados = ['nos_injection', 'emp_shield', 'drift_tires'];
  const resultados = await Promise.allSettled(
    Array.from({ length: 6 }, () =>
      GameRunService.iniciar(user.id, {
        streamerId: '33333333-3333-3333-3333-333333333333',
        gameId: 'neon_drifter',
        itemIds: equipados
      })
    )
  );

  const aceitos = resultados.filter((r) => r.status === 'fulfilled');
  assert.equal(aceitos.length, 1, 'Apenas 1 das 6 rodadas paralelas pode ser aceita');
  assert.equal((await UserModel.findById(user.id)).lives, 0);
  resultados
    .filter((r) => r.status === 'rejected')
    .forEach((r) =>
      assert.ok(
        ['NO_LIVES_REMAINING', 'RUN_ALREADY_OPEN'].includes(r.reason.message),
        `rejeição inesperada: ${r.reason.message}`
      )
    );
});

test('GameRunService: streamer continua jogando sem consumir vidas', async () => {
  await require('../src/config/database').whenReady();
  const id = unico();
  const streamer = await UserModel.create({
    username: `stream_${id}`,
    email: `stream_${id}@test.com`,
    password: 'demo123Password',
    role: 'streamer'
  });
  const antes = (await UserModel.findById(streamer.id)).lives;

  // Em sequência: uma rodada aberta por usuário de cada vez é regra do banco.
  for (let i = 0; i < 4; i++) {
    const rodada = await GameRunService.iniciar(streamer.id, {
      streamerId: '33333333-3333-3333-3333-333333333333',
      gameId: 'neon_drifter'
    });
    assert.ok(rodada.runId, `rodada ${i + 1} do streamer`);
  }

  assert.equal((await UserModel.findById(streamer.id)).lives, antes, 'Vidas não são debitadas');
});

test('AuthService: registro recusa e-mail inválido e campos acima do limite da coluna', async () => {
  const base = () => ({
    username: `val${unico()}`,
    email: `val${unico()}@exemplo.com`,
    password: 'senha123'
  });

  await assert.rejects(
    () =>
      AuthService.register({
        ...base(),
        email: 'isso nao e email',
        birthDate: '1990-05-20',
        acceptedTerms: true
      }),
    {
      message: 'INVALID_EMAIL'
    }
  );
  await assert.rejects(
    () =>
      AuthService.register({
        ...base(),
        email: `${'a'.repeat(480)}@x.com`,
        birthDate: '1990-05-20',
        acceptedTerms: true
      }),
    { message: 'INVALID_EMAIL' }
  );
  await assert.rejects(
    () =>
      AuthService.register({
        ...base(),
        name: 'N'.repeat(5000),
        birthDate: '1990-05-20',
        acceptedTerms: true
      }),
    {
      message: 'INVALID_NAME_LENGTH'
    }
  );
  await assert.rejects(
    () =>
      AuthService.register({
        ...base(),
        phone: '9'.repeat(5000),
        birthDate: '1990-05-20',
        acceptedTerms: true
      }),
    {
      message: 'INVALID_PHONE_LENGTH'
    }
  );
  await assert.rejects(
    () =>
      AuthService.register({
        ...base(),
        password: 'p'.repeat(100000),
        birthDate: '1990-05-20',
        acceptedTerms: true
      }),
    {
      message: 'INVALID_PASSWORD_LENGTH'
    }
  );

  // Regressão: um cadastro legítimo continua passando
  const ok = await AuthService.register({
    ...base(),
    name: 'Fulano',
    phone: '(11) 99999-8888',
    birthDate: '1990-05-20',
    acceptedTerms: true
  });
  assert.ok(ok.token, 'Cadastro válido deve continuar funcionando');
});

test('StreamerRewardService: brinde recusa valores fora dos limites do schema', async () => {
  const base = {
    streamer_id: NIGHTPILOT_ID,
    streamer_username: 'nightpilot',
    image_url: 'https://example.com/brinde.png',
    delivery_type: 'physical',
    title: 'Titulo valido',
    description: 'Descricao valida do brinde',
    price_coins: 100,
    stock: 5
  };

  // title VARCHAR(120) e stock INT no PostgreSQL: sem estes limites o valor só
  // era recusado pelo banco, devolvendo 500 em vez de erro de validação.
  await assert.rejects(() =>
    StreamerRewardService.createReward({ ...base, title: 'A'.repeat(5000) })
  );
  await assert.rejects(
    () => StreamerRewardService.createReward({ ...base, description: 'D'.repeat(50000) }),
    /INVALID_DESCRIPTION/
  );
  await assert.rejects(() => StreamerRewardService.createReward({ ...base, stock: 99999999999 }), {
    message: /INVALID_STOCK/
  });
  await assert.rejects(() => StreamerRewardService.createReward({ ...base, stock: 1.5 }), {
    message: /INVALID_STOCK/
  });
  await assert.rejects(() => StreamerRewardService.createReward({ ...base, price_coins: 1e300 }), {
    message: /INVALID_PRICE/
  });
  await assert.rejects(
    () => StreamerRewardService.createReward({ ...base, price_coins: Infinity }),
    {
      message: /INVALID_PRICE/
    }
  );

  // Regressão: um brinde legítimo continua sendo criado
  const criado = await StreamerRewardService.createReward(base);
  assert.ok(criado.reward || criado.id, 'Brinde válido deve continuar sendo criado');
});

test('LivePixService: mensagem longa de doação não dispara uma consulta por palavra', async () => {
  const UserModel = require('../src/models/userModel');
  const LivePixService = require('../src/services/livepixService');

  let porUsername = 0;
  let porLote = 0;
  const origUm = UserModel.findByUsername.bind(UserModel);
  const origLote = UserModel.findManyByUsernames.bind(UserModel);
  UserModel.findByUsername = async (u) => {
    porUsername++;
    return origUm(u);
  };
  UserModel.findManyByUsernames = async (l) => {
    porLote++;
    return origLote(l);
  };

  try {
    // O texto vem de quem doa: consultar palavra por palavra fazia o webhook
    // crescer linearmente com o tamanho da mensagem e estourar o tempo do provedor.
    const mensagem = Array.from({ length: 300 }, (_, i) => `palavra${i}`).join(' ');
    await LivePixService.findTargetUser({ message: mensagem, comment: '' });

    assert.equal(porLote, 1, 'Os candidatos devem ser resolvidos em uma única consulta');
    // A única consulta individual tolerada é o fallback de ambiente de teste
    // (viewer_alpha) no fim de findTargetUser — jamais uma por palavra.
    assert.ok(
      porUsername <= 1,
      `Esperava no máximo 1 consulta individual (fallback), recebeu ${porUsername}`
    );

    // Regressão: a menção continua identificando o usuário, respeitando a ordem
    // em que os nomes aparecem no texto.
    const doisNomes = await LivePixService.findTargetUser({
      message: 'obrigado nightpilot e sub_beta',
      comment: ''
    });
    assert.equal(doisNomes && doisNomes.username, 'nightpilot');
  } finally {
    UserModel.findByUsername = origUm;
    UserModel.findManyByUsernames = origLote;
  }
});
