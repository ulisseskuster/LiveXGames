// O Express 4 não captura rejeição de função async: uma rejeição solta num
// handler vira unhandledRejection e o Node encerra o processo. Enquanto os
// models engoliam erro de banco isso quase nunca aparecia; agora que o erro
// propaga (ver db.fallbackOrThrow), qualquer handler async desprotegido é uma
// forma de derrubar o serviço — e /webhooks/* nem exige autenticação.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const StreamerPaymentConfigModel = require('../src/models/streamerPaymentConfigModel');
const { validateStreamerWebhookSignature } = require('../src/middlewares/auth');

test('falha de banco no webhook vira next(err), não unhandled rejection', async () => {
  const original = StreamerPaymentConfigModel.findByStreamerId;
  StreamerPaymentConfigModel.findByStreamerId = async () => {
    throw new Error('Connection terminated unexpectedly');
  };

  try {
    const middleware = validateStreamerWebhookSignature('livepix');
    const req = {
      params: { streamerId: 'qualquer' },
      headers: { 'x-livepix-signature': 'ab' },
      body: {}
    };
    const res = { status: () => res, json: () => res };

    const recebido = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('next() nunca foi chamado')), 2000);
      middleware(req, res, (err) => {
        clearTimeout(t);
        resolve(err);
      });
    });

    assert.ok(recebido instanceof Error, 'o erro deve chegar ao tratador global via next(err)');
    assert.match(recebido.message, /Connection terminated/);
  } finally {
    StreamerPaymentConfigModel.findByStreamerId = original;
  }
});

test('nenhum handler async do Express fica sem try/catch', () => {
  const raiz = path.join(__dirname, '..', 'src');
  const alvos = ['routes', 'middlewares', 'controllers']
    .flatMap((dir) => fs.readdirSync(path.join(raiz, dir)).map((f) => path.join(raiz, dir, f)))
    .concat([path.join(raiz, 'server.js')])
    .filter((f) => f.endsWith('.js'));

  const padroes = [
    /async \((req|_req)\b[^)]*\)\s*=>\s*\{/g,
    /async \w+\((req|_req)\b[^)]*\)\s*\{/g
  ];
  const desprotegidos = [];

  for (const arquivo of alvos) {
    const src = fs.readFileSync(arquivo, 'utf8');
    for (const padrao of padroes) {
      for (const m of src.matchAll(padrao)) {
        // Corpo da função: do '{' de abertura até a chave que o equilibra.
        let nivel = 0;
        const inicio = src.indexOf('{', m.index);
        let fim = src.length;
        for (let j = inicio; j < src.length; j++) {
          if (src[j] === '{') nivel += 1;
          else if (src[j] === '}' && --nivel === 0) {
            fim = j;
            break;
          }
        }
        if (!src.slice(inicio, fim).includes('try {')) {
          desprotegidos.push(
            `${path.basename(arquivo)}:${src.slice(0, m.index).split('\n').length}`
          );
        }
      }
    }
  }

  assert.deepEqual(
    desprotegidos,
    [],
    `handler async sem try/catch derruba o processo se a promessa rejeitar: ${desprotegidos.join(', ')}`
  );
});
