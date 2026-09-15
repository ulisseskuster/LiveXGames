// @ts-check
const fs = require('fs');
const path = require('path');

/**
 * Wrapper Node do .wasm da simulação (games/sim).
 *
 * É o MESMO arquivo que o navegador carrega (via games/client/src/shell/simWasm.ts).
 * Não existe regra de jogo em JavaScript: este arquivo só copia bytes para dentro
 * do módulo e lê números de volta. Se um dia alguém precisar "consertar" um
 * resultado aqui, o conserto é na crate e numa SIM_VERSION nova.
 */

const SIM_DIR = path.join(__dirname, '../../../../frontend/public/games');
const SIM_WASM_PATH = path.join(SIM_DIR, 'livex_sim.wasm');
const SIM_MANIFEST_PATH = path.join(SIM_DIR, 'sim-manifest.json');

/** Espelha as constantes ERR_* de games/sim/src/run.rs. */
const ERROS = new Map([
  [-1, 'BAD_HANDLE'],
  [-2, 'UNKNOWN_GAME'],
  [-3, 'BAD_LOADOUT'],
  [-4, 'BAD_LOG'],
  [-5, 'LOG_EXCEEDS_MAX_TICKS'],
  [-6, 'END_MISMATCH'],
  [-7, 'BAD_SEED']
]);
const MOTIVOS_FIM = ['running', 'game_over', 'quit', 'max_ticks'];

/** Campos por amostra de telemetria (TELEMETRY_FIELDS em run.rs). */
const TELEMETRIA_CAMPOS = 9;

/** Maior contagem de ticks que cabe no u32 do .wasm: "rode até acabar". */
const ATE_O_FIM = 0xffffffff;

function nomeDoErro(codigo) {
  return ERROS.get(codigo) || `ERRO_${codigo}`;
}

// O tsconfig do backend carrega só a lib ES2022, que não declara WebAssembly
// (vem da lib DOM). Puxar a DOM inteira para o backend esconderia uso indevido de
// globais de navegador; o cast fica restrito a este ponto.
/** @type {any} */
const WasmGlobal = /** @type {any} */ (globalThis).WebAssembly;

class SimRuntime {
  /** @param {any} instance */
  constructor(instance) {
    /** @type {any} */
    this.x = instance.exports;
  }

  static async load(wasmPath = SIM_WASM_PATH) {
    const bytes = fs.readFileSync(wasmPath);
    const { instance } = await WasmGlobal.instantiate(bytes, {});
    return new SimRuntime(instance);
  }

  get version() {
    return this.x.sim_version();
  }

  maxTicks(gameCode) {
    return this.x.game_max_ticks(gameCode);
  }

  /**
   * Copia os buffers para a memória do módulo, chama `fn` e libera.
   * As views sobre `memory.buffer` são refeitas a cada uso: qualquer alocação
   * pode crescer a memória e invalidar uma view antiga.
   *
   * @param {Uint8Array[]} buffers
   * @param {(alocados: Array<{ptr: number, len: number}>) => number} fn
   */
  comBuffers(buffers, fn) {
    const alocados = buffers.map((b) => {
      const len = b.length;
      const ptr = len ? this.x.alloc(len) : 0;
      if (len) new Uint8Array(this.x.memory.buffer, ptr, len).set(b);
      return { ptr, len };
    });
    try {
      return fn(alocados);
    } finally {
      for (const a of alocados) if (a.len) this.x.dealloc(a.ptr, a.len);
    }
  }

  resultado(handle) {
    const ptr = this.x.run_result(handle);
    const r = new Float64Array(this.x.memory.buffer, ptr, 10);
    const hex = (v) => (v >>> 0).toString(16).padStart(8, '0');
    return {
      ended: r[0] === 1,
      ticks: r[1],
      distance: r[2],
      score: r[3],
      peak: r[4],
      itemsUsedMask: r[5],
      hash: hex(r[6]) + hex(r[7]),
      endReason: MOTIVOS_FIM[r[8]] || 'running',
      gameCode: r[9]
    };
  }

  telemetria(handle) {
    const len = this.x.run_telemetry_len(handle);
    if (!len) return [];
    const ptr = this.x.run_telemetry_ptr(handle);
    return Array.from(new Float32Array(this.x.memory.buffer, ptr, len));
  }

  log(handle) {
    const len = this.x.run_log_len(handle);
    const ptr = this.x.run_log_ptr(handle);
    return Buffer.from(new Uint8Array(this.x.memory.buffer, ptr, len));
  }

  /**
   * Reexecuta uma partida a partir do log. É o coração do anticheat.
   *
   * @param {{gameCode: number, seed: Uint8Array, loadout: Uint8Array, log: Uint8Array}} partida
   */
  replay({ gameCode, seed, loadout, log }) {
    const handle = this.comBuffers([seed, loadout, log], ([s, l, g]) =>
      this.x.replay_new(gameCode, s.ptr, s.len, l.ptr, l.len, g.ptr, g.len)
    );
    if (handle < 0) return { ok: false, error: nomeDoErro(handle) };
    try {
      const status = this.x.run_step(handle, ATE_O_FIM);
      if (status < 0) return { ok: false, error: nomeDoErro(status) };
      return { ok: true, result: this.resultado(handle), telemetry: this.telemetria(handle) };
    } finally {
      this.x.run_free(handle);
    }
  }

  /**
   * Joga uma partida inteira com o bot aleatório da crate e devolve o log, como
   * um navegador faria. Usado em testes e para medir o custo da verificação.
   *
   * @param {{gameCode: number, seed: Uint8Array, loadout?: Uint8Array, botSeed?: number,
   *          skill?: number, sairNoTick?: number | null}} opcoes
   */
  jogarComBot({
    gameCode,
    seed,
    loadout = Buffer.alloc(0),
    botSeed = 1,
    skill = 0,
    sairNoTick = null
  }) {
    const handle = this.comBuffers([seed, loadout], ([s, l]) =>
      this.x.run_new(gameCode, s.ptr, s.len, l.ptr, l.len)
    );
    if (handle < 0) throw new Error(nomeDoErro(handle));
    try {
      if (skill) {
        this.x.run_attach_skill_bot(
          handle,
          skill,
          Math.floor(botSeed / 2 ** 32) >>> 0,
          botSeed >>> 0
        );
      } else {
        this.x.run_attach_bot(handle, Math.floor(botSeed / 2 ** 32) >>> 0, botSeed >>> 0);
      }
      if (sairNoTick === null) {
        this.x.run_step(handle, ATE_O_FIM);
      } else {
        this.x.run_step(handle, sairNoTick);
        this.x.run_quit(handle);
      }
      return {
        log: this.log(handle),
        result: this.resultado(handle),
        telemetry: this.telemetria(handle)
      };
    } finally {
      this.x.run_free(handle);
    }
  }
}

let manifestoEmCache = null;

/**
 * Manifesto gerado por scripts/build-games.js: versão da simulação e hash do
 * .wasm publicado. Lido uma vez por processo — um deploy novo reinicia o processo.
 *
 * @returns {{simVersion: number, wasm: string, sha256: string} | null}
 */
function lerManifesto() {
  if (manifestoEmCache) return manifestoEmCache;
  try {
    manifestoEmCache = JSON.parse(fs.readFileSync(SIM_MANIFEST_PATH, 'utf8'));
    return manifestoEmCache;
  } catch (err) {
    return null;
  }
}

module.exports = {
  SimRuntime,
  SIM_WASM_PATH,
  SIM_MANIFEST_PATH,
  TELEMETRIA_CAMPOS,
  lerManifesto
};
