/**
 * Compila os jogos: crate Rust → .wasm otimizado → cliente Vite → frontend/public/games.
 * Roda com `npm run games:build`.
 *
 * A saída é commitada (README.md, Build dos jogos): o Render não tem Rust, e o deploy
 * continua sendo `npm install` no backend. O CI confere se ela corresponde às
 * fontes (scripts/check-games-build.js).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const SIM_DIR = path.join(RAIZ, 'games', 'sim');
const CLIENTE_DIR = path.join(RAIZ, 'games', 'client');
const SAIDA_DIR = path.join(RAIZ, 'frontend', 'public', 'games');
const MANIFESTO_FONTES = path.join(RAIZ, 'games', 'build-manifest.json');

/** Tudo cujo conteúdo muda a saída do build. Testes ficam de fora de propósito. */
const FONTES = [
  'games/sim/src',
  'games/sim/Cargo.toml',
  'games/sim/Cargo.lock',
  'games/sim/rust-toolchain.toml',
  'games/client/src',
  'games/client/sandbox.html',
  'games/client/vite.config.ts',
  'games/client/tsconfig.json',
  'games/client/package.json',
  'games/client/package-lock.json'
];

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function listarArquivos(rel) {
  const abs = path.join(RAIZ, rel);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [rel];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .flatMap((d) => listarArquivos(path.posix.join(rel, d.name)));
}

/**
 * Hash das fontes, não da saída. Comparar bytes do .wasm entre máquinas não
 * funciona (o compilador embute caminhos absolutos), mas as fontes são as mesmas
 * em qualquer checkout. CRLF vira LF: com core.autocrlf, o mesmo commit tem bytes
 * diferentes no Windows e no Linux.
 */
function hashDasFontes() {
  const h = crypto.createHash('sha256');
  for (const rel of FONTES.flatMap(listarArquivos).sort()) {
    const conteudo = fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
    h.update(rel).update('\0').update(conteudo).update('\0');
  }
  return h.digest('hex');
}

function localizarCargo() {
  const nome = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
  const noHome = path.join(os.homedir(), '.cargo', 'bin', nome);
  return fs.existsSync(noHome) ? noHome : nome;
}

function rodar(cmd, args, opcoes = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opcoes });
}

async function compilarSimulacao() {
  // cwd em games/sim: é lá que o rustup encontra o rust-toolchain.toml.
  rodar(localizarCargo(), ['build', '--release', '--target', 'wasm32-unknown-unknown'], {
    cwd: SIM_DIR
  });
  const bruto = path.join(SIM_DIR, 'target', 'wasm32-unknown-unknown', 'release', 'livex_sim.wasm');
  const otimizado = path.join(SIM_DIR, 'target', 'livex_sim.opt.wasm');
  const wasmOpt = path.join(CLIENTE_DIR, 'node_modules', 'binaryen', 'bin', 'wasm-opt');
  // Exatamente os recursos que o rustc liga por padrão no wasm32-unknown-unknown,
  // nenhum a mais. `--all-features` deixaria o otimizador livre para emitir SIMD
  // — e relaxed-simd é não determinístico por especificação (README.md, Determinismo).
  const recursos = [
    '--enable-bulk-memory',
    '--enable-bulk-memory-opt',
    '--enable-sign-ext',
    '--enable-mutable-globals',
    '--enable-nontrapping-float-to-int',
    '--enable-multivalue',
    '--enable-reference-types'
  ];
  rodar(process.execPath, [wasmOpt, bruto, ...recursos, '-O3', '-o', otimizado]);

  const bytes = fs.readFileSync(otimizado);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return { bytes, simVersion: instance.exports.sim_version(), sha256: sha256(bytes) };
}

/**
 * games/loader.js: o único arquivo dos jogos com nome fixo. O index.html aponta
 * para ele com ?v=<hash> (scripts/stamp-assets.js), e ele importa o bundle de
 * embed com hash no nome. Sem isto, cada build exigiria editar o index.html à mão.
 */
function escreverCarregador() {
  const manifestoVite = path.join(SAIDA_DIR, '.vite', 'manifest.json');
  const manifesto = JSON.parse(fs.readFileSync(manifestoVite, 'utf8'));
  const entrada = manifesto['src/embed/main.ts'];
  if (!entrada || !entrada.file) {
    throw new Error('Manifesto do Vite sem a entrada src/embed/main.ts');
  }
  // Import dinâmico: quem só visita a homepage não baixa Three.js nem a simulação.
  fs.writeFileSync(
    path.join(SAIDA_DIR, 'loader.js'),
    '// Gerado por scripts/build-games.js. Registra o carregador dos jogos novos;\n' +
      '// o bundle só é baixado quando a Arena chama window.LiveXJogosCarregar().\n' +
      `window.LiveXJogosCarregar = () => import('./${entrada.file}');\n` +
      "window.dispatchEvent(new Event('livex-jogos-carregador'));\n"
  );
  // O manifesto é insumo do build, não conteúdo para servir.
  fs.rmSync(path.join(SAIDA_DIR, '.vite'), { recursive: true, force: true });
}

async function main() {
  const sim = await compilarSimulacao();

  const vite = path.join(CLIENTE_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  rodar(process.execPath, [vite, 'build'], {
    cwd: CLIENTE_DIR,
    env: {
      ...process.env,
      LIVEX_SIM_WASM_URL: `/games/livex_sim.wasm?v=${sim.sha256.slice(0, 10)}`
    }
  });

  escreverCarregador();

  // Depois do Vite: o emptyOutDir dele apagaria o que fosse escrito antes.
  fs.writeFileSync(path.join(SAIDA_DIR, 'livex_sim.wasm'), sim.bytes);
  fs.writeFileSync(
    path.join(SAIDA_DIR, 'sim-manifest.json'),
    JSON.stringify(
      { simVersion: sim.simVersion, wasm: 'livex_sim.wasm', sha256: sim.sha256 },
      null,
      2
    ) + '\n'
  );
  fs.writeFileSync(MANIFESTO_FONTES, JSON.stringify({ fontes: hashDasFontes() }, null, 2) + '\n');

  const kb = (n) => (n / 1024).toFixed(1);
  console.log(
    `[games:build] simulação v${sim.simVersion}: ${kb(sim.bytes.length)} KB ` +
      `(${kb(zlib.gzipSync(sim.bytes).length)} KB gzip) em frontend/public/games`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[games:build] Falhou:', err.message);
    process.exit(1);
  });
}

module.exports = {
  RAIZ,
  SIM_DIR,
  CLIENTE_DIR,
  SAIDA_DIR,
  MANIFESTO_FONTES,
  hashDasFontes,
  localizarCargo,
  rodar,
  sha256
};
