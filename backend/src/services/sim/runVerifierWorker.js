// @ts-check
const { parentPort } = require('worker_threads');
const { performance } = require('perf_hooks');
const { SimRuntime } = require('./simRuntime');

/**
 * Worker do verificador: um .wasm instanciado por thread, uma partida por vez.
 * Fora do event loop do Express porque, com os jogos reais, reexecutar 120 s de
 * simulação ocupa CPU de verdade — no processo principal isso seguraria todas as
 * requisições do site enquanto roda.
 */

if (!parentPort) {
  throw new Error('runVerifierWorker.js precisa rodar como worker_thread');
}
const porta = parentPort;
const runtime = SimRuntime.load();

porta.on('message', async (job) => {
  try {
    const rt = await runtime;
    const inicio = performance.now();
    const saida =
      job.operacao === 'gerar'
        ? rt.jogarComBot({
            gameCode: job.gameCode,
            seed: Buffer.from(job.seed),
            loadout: Buffer.from(job.loadout),
            botSeed: job.botSeed,
            skill: job.skill || 0
          })
        : rt.replay({
            gameCode: job.gameCode,
            seed: Buffer.from(job.seed),
            loadout: Buffer.from(job.loadout),
            log: Buffer.from(job.log)
          });
    if (job.operacao === 'gerar') {
      saida.log = Buffer.from(saida.log);
    }
    porta.postMessage({
      ok: true,
      result: {
        ...saida,
        log: saida.log,
        simVersion: rt.version,
        ms: performance.now() - inicio
      }
    });
  } catch (err) {
    porta.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
