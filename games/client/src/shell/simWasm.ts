/**
 * Wrapper do .wasm da simulação no navegador.
 *
 * Espelha backend/src/services/sim/simRuntime.js: mesmo arquivo, mesmas
 * exportações, mesmo layout de resultado. Não há regra de jogo aqui — só cópia
 * de bytes e leitura de números.
 */

export type ResultadoSim = {
  terminou: boolean;
  ticks: number;
  distancia: number;
  score: number;
  pico: number;
  mascaraItensUsados: number;
  hash: string;
  motivoFim: string;
  codigoJogo: number;
};

interface ExportsSim {
  memory: WebAssembly.Memory;
  sim_version(): number;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  run_new(game: number, seedPtr: number, seedLen: number, loPtr: number, loLen: number): number;
  replay_new(
    game: number,
    seedPtr: number,
    seedLen: number,
    loPtr: number,
    loLen: number,
    logPtr: number,
    logLen: number
  ): number;
  run_set_input(handle: number, buttons: number, ax: number, ay: number): number;
  run_attach_bot(handle: number, seedHi: number, seedLo: number): number;
  run_step(handle: number, n: number): number;
  run_quit(handle: number): number;
  run_result(handle: number): number;
  run_render_len(handle: number): number;
  run_render_ptr(handle: number): number;
  run_telemetry_len(handle: number): number;
  run_telemetry_ptr(handle: number): number;
  run_log_len(handle: number): number;
  run_log_ptr(handle: number): number;
  run_free(handle: number): void;
}

const MOTIVOS_FIM = ['running', 'game_over', 'quit', 'max_ticks'];
/** Maior valor do u32 do .wasm: "avance até a partida acabar". */
export const ATE_O_FIM = 0xffffffff;

export class SimWasm {
  private constructor(private readonly x: ExportsSim) {}

  static async carregar(url: string): Promise<SimWasm> {
    const resposta = await fetch(url);
    if (!resposta.ok) throw new Error(`Falha ao baixar a simulação (HTTP ${resposta.status})`);
    // arrayBuffer em vez de instantiateStreaming: o streaming exige o MIME
    // application/wasm exato, e um proxy no caminho que mude o cabeçalho
    // derrubaria o jogo inteiro por um detalhe de transporte.
    const { instance } = await WebAssembly.instantiate(await resposta.arrayBuffer(), {});
    return new SimWasm(instance.exports as unknown as ExportsSim);
  }

  get versao(): number {
    return this.x.sim_version();
  }

  novaPartida(codigoJogo: number, semente: Uint8Array, loadout: Uint8Array): number {
    const handle = this.comBuffers([semente, loadout], ([s, l]) =>
      this.x.run_new(codigoJogo, s.ptr, s.len, l.ptr, l.len)
    );
    if (handle < 0) throw new Error(`A simulação recusou a partida (código ${handle})`);
    return handle;
  }

  replayPartida(
    codigoJogo: number,
    semente: Uint8Array,
    loadout: Uint8Array,
    log: Uint8Array
  ): number {
    return this.comBuffers([semente, loadout, log], ([s, l, g]) => {
      const handle = this.x.replay_new(codigoJogo, s.ptr, s.len, l.ptr, l.len, g.ptr, g.len);
      if (handle < 0) throw new Error(`O replay foi recusado (código ${handle})`);
      return handle;
    });
  }

  entrada(handle: number, botoes: number, ax: number, ay: number): void {
    this.x.run_set_input(handle, botoes, ax, ay);
  }

  anexarBot(handle: number, semente: number): void {
    this.x.run_attach_bot(handle, Math.floor(semente / 2 ** 32) >>> 0, semente >>> 0);
  }

  /** 1 terminou, 0 segue, negativo é erro. */
  avancar(handle: number, ticks: number): number {
    return this.x.run_step(handle, ticks);
  }

  sair(handle: number): void {
    this.x.run_quit(handle);
  }

  resultado(handle: number): ResultadoSim {
    const r = new Float64Array(this.x.memory.buffer, this.x.run_result(handle), 10);
    const hex = (v: number) => (v >>> 0).toString(16).padStart(8, '0');
    return {
      terminou: r[0] === 1,
      ticks: r[1],
      distancia: r[2],
      score: r[3],
      pico: r[4],
      mascaraItensUsados: r[5],
      hash: hex(r[6]) + hex(r[7]),
      motivoFim: MOTIVOS_FIM[r[8]] ?? 'running',
      codigoJogo: r[9]
    };
  }

  /** Cópia: a view sobre a memória do módulo morre na próxima alocação. */
  render(handle: number): Float32Array {
    const len = this.x.run_render_len(handle);
    return new Float32Array(this.x.memory.buffer, this.x.run_render_ptr(handle), len).slice();
  }

  telemetria(handle: number): Float32Array {
    const len = this.x.run_telemetry_len(handle);
    if (len === 0) return new Float32Array(0);
    return new Float32Array(this.x.memory.buffer, this.x.run_telemetry_ptr(handle), len).slice();
  }

  log(handle: number): Uint8Array {
    const len = this.x.run_log_len(handle);
    return new Uint8Array(this.x.memory.buffer, this.x.run_log_ptr(handle), len).slice();
  }

  liberar(handle: number): void {
    this.x.run_free(handle);
  }

  private comBuffers(
    buffers: Uint8Array[],
    fn: (alocados: Array<{ ptr: number; len: number }>) => number
  ): number {
    const alocados = buffers.map((b) => {
      const ptr = b.length ? this.x.alloc(b.length) : 0;
      if (b.length) new Uint8Array(this.x.memory.buffer, ptr, b.length).set(b);
      return { ptr, len: b.length };
    });
    try {
      return fn(alocados);
    } finally {
      for (const a of alocados) if (a.len) this.x.dealloc(a.ptr, a.len);
    }
  }
}

export function hexParaBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error('Semente em formato inválido');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function base64ParaBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Em blocos: String.fromCharCode(...bytes) estoura a pilha com logs grandes. */
export function bytesParaBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
