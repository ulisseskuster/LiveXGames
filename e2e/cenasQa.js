// QA local das cenas: quadros do WASM publicado, sem conta, API ou recompensas.
// node e2e/cenasQa.js [jet_launcher|neon_drifter|void_walker]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { codificarLoadout } = require('../backend/src/services/sim/loadoutCodec');

const raiz = path.join(__dirname, '..');
const saida = path.join(raiz, 'artifacts/cenas-2026-09-14');
const jogos = {
  jet_launcher: ['CenaJet', 1],
  neon_drifter: ['CenaNeon', 2],
  void_walker: ['CenaVoid', 3]
};
const escolhido = process.argv[2];
const loadout = [
  ...codificarLoadout([
    { id: 'shield_deflector', flight_bonus: { effect: 'shield', activation: 'auto', charges: 1 } }
  ])
];

async function main() {
  const { createServer } = await import('../games/client/node_modules/vite/dist/node/index.js');
  const server = await createServer({
    configFile: false,
    root: path.join(raiz, 'games/client'),
    base: '/games/',
    server: { host: '127.0.0.1', port: 5179, strictPort: true },
    logLevel: 'error',
    plugins: [
      {
        name: 'qa-local',
        configureServer(server) {
          server.middlewares.use('/games/qa.html', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><html><head><title>QA local de cenas</title><style>html,body{margin:0;width:100%;height:100%;background:#07111d}canvas{display:block;width:100%;height:100%}</style></head><body><canvas></canvas></body></html>'
            );
          });
          server.middlewares.use('/games/qa.wasm', (_req, res) => {
            res.setHeader('Content-Type', 'application/wasm');
            res.end(fs.readFileSync(path.join(raiz, 'frontend/public/games/livex_sim.wasm')));
          });
        }
      }
    ]
  });
  let browser;
  const resultados = [];
  try {
    await server.listen();
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    fs.mkdirSync(saida, { recursive: true });
    for (const [game, [classe, codigo]] of Object.entries(jogos)) {
      if (escolhido && escolhido !== game) continue;
      for (const reduzido of [false, true]) {
        const page = await browser.newPage({
          viewport: { width: 1440, height: 810 },
          reducedMotion: reduzido ? 'reduce' : 'no-preference'
        });
        const erros = [];
        page.on('pageerror', (e) => erros.push(e.message));
        await page.goto('http://127.0.0.1:5179/games/qa.html');
        const fixture = await page.evaluate(
          async ({ game, classe, codigo, reduzido, loadout }) => {
            const { criarRenderer, nomeDoBackend } = await import('/games/src/shell/renderer.ts');
            const { SimWasm } = await import('/games/src/shell/simWasm.ts');
            const { H } = await import('/games/src/shell/cabecalho.ts');
            const modulo = await import(`/games/src/${game}/cena.ts`);
            const canvas = document.querySelector('canvas');
            const renderer = await criarRenderer(canvas, true);
            renderer.setPixelRatio(1);
            const cena = new modulo[classe](renderer, canvas, {
              assinante: false,
              lendario: false,
              reduzirMovimento: reduzido,
              bloom: true
            });
            const sim = await SimWasm.carregar('/games/qa.wasm');
            let quadros, resultado, semente, escudo;
            // Encontra um impacto real para conferir o halo, em vez de inventar evento.
            for (semente = 1; semente <= 12; semente++) {
              const h = sim.novaPartida(
                codigo,
                new Uint8Array(32).fill(semente),
                new Uint8Array(codigo === 1 ? loadout : [])
              );
              sim.anexarBot(h, semente);
              quadros = [sim.render(h)];
              while (!sim.avancar(h, 1)) quadros.push(sim.render(h));
              quadros.push(sim.render(h));
              resultado = sim.resultado(h);
              sim.liberar(h);
              escudo = quadros.findIndex((b) => (b[H.EVENTOS] & (1 << 8)) !== 0);
              if (codigo !== 1 || escudo >= 0) break;
            }
            window.qa = { cena, renderer, quadros, H, codigo };
            window.qa.desenhar = (indice) => {
              const b = quadros[indice],
                a = quadros[Math.max(0, indice - 1)];
              const antes = Array.from(b).join(',');
              for (let i = 0; i < 90; i++)
                cena.atualizar(
                  { anterior: a, atual: b, alfa: 1, tick: indice },
                  1000 + indice * 17 + i * 17
                );
              cena.desenhar();
              if (antes !== Array.from(b).join(','))
                throw new Error('Cena modificou o buffer de entrada');
              return cena.scene.getObjectByName('halo-escudo')?.visible;
            };
            window.qa.desenhar(0);
            await cena.aquecer();
            return {
              semente,
              resultado,
              backend: nomeDoBackend(renderer),
              escudo,
              batida: quadros.findIndex((b, i) => i > escudo && (b[H.EVENTOS] & (1 << 9)) !== 0),
              expirado: quadros.findIndex((b, i) => i > escudo && b[H.INVULNERAVEL] === 0),
              passagem: quadros.findIndex((b) => b[H.Z] >= 430),
              climax: Math.floor(quadros.length * 0.9)
            };
          },
          { game, classe, codigo, reduzido, loadout }
        );
        if (codigo === 1) {
          assert(fixture.escudo > 0, 'Fixture deve conter evento real de escudo');
          assert.equal(await page.evaluate((i) => window.qa.desenhar(i), fixture.escudo), true);
          await page.screenshot({
            path: path.join(saida, `${game}-escudo-${reduzido ? 'reduzido' : 'normal'}.png`)
          });
          assert.equal(await page.evaluate((i) => window.qa.desenhar(i), fixture.expirado), false);
          assert(
            fixture.batida > fixture.escudo,
            'Fixture deve conter batida após consumir escudo'
          );
          assert.equal(await page.evaluate((i) => window.qa.desenhar(i), fixture.batida), false);
          assert.equal(await page.evaluate(() => window.qa.desenhar(0)), false);
        }
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: width < 768 ? 570 : 810 });
          await page.evaluate(
            () =>
              new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          );
          await page.evaluate(
            (i) => window.qa.desenhar(i),
            codigo === 2 ? fixture.passagem : fixture.climax
          );
          await page.screenshot({
            path: path.join(saida, `${game}-${width}-${reduzido ? 'reduzido' : 'normal'}.png`)
          });
        }
        assert.deepEqual(erros, []);
        resultados.push({ game, reduzido, ...fixture });
        await page.evaluate(() => {
          window.qa.cena.destruir();
          window.qa.renderer.dispose();
        });
        await page.close();
        console.log(`[cenas:qa] ${game} / reduzido=${reduzido}: OK`);
      }
    }
    fs.writeFileSync(
      path.join(saida, `${escolhido || 'todos'}-qa.json`),
      JSON.stringify(resultados, null, 2) + '\n'
    );
  } finally {
    await browser?.close();
    await server.close();
  }
}
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
