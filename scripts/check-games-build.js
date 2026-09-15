/**
 * Confere se a saída commitada dos jogos (frontend/public/games) corresponde às
 * fontes. Roda no CI e com `npm run games:check`.
 *
 * 1. O hash das fontes gravado no último build bate com as fontes atuais?
 *    (Pega "mexeu na crate ou no cliente e esqueceu de rodar games:build".)
 * 2. O .wasm publicado é o que o manifesto diz?
 * 3. Com `--wasm-novo <arquivo>`: joga as mesmas partidas no .wasm publicado e num
 *    recém-compilado e exige resultados idênticos. Bytes podem diferir entre
 *    máquinas; comportamento, não.
 */
const fs = require('fs');
const path = require('path');
const { MANIFESTO_FONTES, SAIDA_DIR, hashDasFontes, sha256 } = require('./build-games');
const { SimRuntime } = require('../backend/src/services/sim/simRuntime');

function falhar(mensagem) {
  console.error(`[games:check] ${mensagem}`);
  process.exit(1);
}

async function compararComportamento(wasmNovo) {
  const publicado = await SimRuntime.load(path.join(SAIDA_DIR, 'livex_sim.wasm'));
  const novo = await SimRuntime.load(wasmNovo);
  if (publicado.version !== novo.version) {
    falhar(`SIM_VERSION publicada (${publicado.version}) difere da compilada (${novo.version}).`);
  }
  for (let i = 0; i < 20; i++) {
    const partida = { gameCode: 0, seed: Buffer.from(`checagem-${i}`), botSeed: i + 1 };
    const a = publicado.jogarComBot(partida);
    const b = novo.jogarComBot(partida);
    if (a.result.hash !== b.result.hash || !a.log.equals(b.log)) {
      falhar(`O .wasm publicado se comporta diferente do compilado agora (partida ${i}).`);
    }
  }
}

async function main() {
  const manifestoFontes = JSON.parse(fs.readFileSync(MANIFESTO_FONTES, 'utf8'));
  if (manifestoFontes.fontes !== hashDasFontes()) {
    falhar(
      'As fontes dos jogos mudaram desde o último build. Rode "npm run games:build" e comite.'
    );
  }

  const manifestoSim = JSON.parse(
    fs.readFileSync(path.join(SAIDA_DIR, 'sim-manifest.json'), 'utf8')
  );
  const wasm = fs.readFileSync(path.join(SAIDA_DIR, manifestoSim.wasm));
  if (sha256(wasm) !== manifestoSim.sha256) {
    falhar('frontend/public/games/livex_sim.wasm não bate com sim-manifest.json.');
  }

  const i = process.argv.indexOf('--wasm-novo');
  if (i > 0) await compararComportamento(path.resolve(process.argv[i + 1]));

  console.log('[games:check] Saída dos jogos corresponde às fontes.');
}

main().catch((err) => falhar(err.message));
