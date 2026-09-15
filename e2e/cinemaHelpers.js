const fs = require('fs');
const path = require('path');

async function enquadrar(page, seletor) {
  await page.locator(seletor).evaluate((el) => {
    const topo = document.querySelector('.topbar').getBoundingClientRect().bottom;
    window.scrollBy(0, el.getBoundingClientRect().top - topo - 16);
  });
}

async function replayNoNavegador(page, rodada) {
  const worker = fs
    .readdirSync(path.join(__dirname, '../frontend/public/games/assets'))
    .find((f) => f.startsWith('sim.worker-'));
  return page.evaluate(
    ({ worker, rodada }) =>
      new Promise((resolve, reject) => {
        const w = new Worker(`/games/assets/${worker}`, { type: 'module' });
        const timer = setTimeout(() => {
          w.terminate();
          reject(new Error('Replay não terminou'));
        }, 10000);
        w.onmessage = ({ data }) => {
          if (data.tipo === 'fim' || data.tipo === 'erro') {
            clearTimeout(timer);
            w.terminate();
            if (data.tipo === 'erro') reject(new Error(data.mensagem));
            else resolve(data.resultado);
          }
        };
        w.onerror = (e) => {
          clearTimeout(timer);
          w.terminate();
          reject(new Error(e.message));
        };
        w.postMessage({
          tipo: 'preparar',
          wasmUrl: '/games/livex_sim.wasm',
          codigoJogo: rodada.gameCode,
          semente: rodada.seed,
          loadout: rodada.loadout,
          replayLog: rodada.replayLog,
          imediato: true
        });
      }),
    { worker, rodada }
  );
}

module.exports = { enquadrar, replayNoNavegador };
