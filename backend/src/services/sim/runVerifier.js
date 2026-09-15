// @ts-check
const path = require('path');
const { Worker } = require('worker_threads');

/**
 * Pool de verificadores (worker_threads). Tamanho 1 por padrão: o plano free do
 * Render tem meia CPU, e dois replays em paralelo só disputariam o mesmo núcleo.
 * `SIM_VERIFIER_WORKERS` sobe o pool quando houver CPU para isso.
 *
 * Cada worker fica `unref` enquanto ocioso — sem isso um processo que só
 * importou este módulo (um teste, um script) nunca terminaria — e `ref` enquanto
 * verifica, para uma verificação em andamento não ser abandonada no meio.
 */

const TAMANHO_POOL = Math.max(1, Number(process.env.SIM_VERIFIER_WORKERS) || 1);
const TEMPO_MAXIMO_MS = 10_000;
const WORKER_PATH = path.join(__dirname, 'runVerifierWorker.js');
function maxFila() {
  const v = Number(process.env.SIM_VERIFIER_MAX_QUEUE);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 32;
}

/**
 * @typedef {{job: object, resolve: (v: any) => void, reject: (e: Error) => void}} Tarefa
 * @typedef {{worker: Worker, atual: Tarefa | null, timer: NodeJS.Timeout | null}} Trabalhador
 */

/** @type {Trabalhador[]} */
const trabalhadores = [];
/** @type {Tarefa[]} */
const fila = [];

function remover(t) {
  const i = trabalhadores.indexOf(t);
  if (i >= 0) trabalhadores.splice(i, 1);
}

/**
 * @param {Trabalhador} t
 * @param {Error | null} erro
 * @param {any} [resultado]
 */
function concluir(t, erro, resultado) {
  const tarefa = t.atual;
  if (!tarefa) return;
  if (t.timer) clearTimeout(t.timer);
  t.atual = null;
  t.timer = null;
  t.worker.unref();
  if (erro) tarefa.reject(erro);
  else tarefa.resolve(resultado);
  despachar();
}

function criarTrabalhador() {
  /** @type {Trabalhador} */
  const t = { worker: new Worker(WORKER_PATH), atual: null, timer: null };
  t.worker.unref();
  t.worker.on('message', (msg) => concluir(t, msg.ok ? null : new Error(msg.error), msg.result));
  t.worker.on('error', (err) => {
    remover(t);
    concluir(t, err);
  });
  t.worker.on('exit', (code) => {
    remover(t);
    concluir(t, new Error(`VERIFIER_EXIT:${code}`));
  });
  trabalhadores.push(t);
  return t;
}

function despachar() {
  while (fila.length > 0) {
    let t = trabalhadores.find((x) => !x.atual);
    if (!t && trabalhadores.length < TAMANHO_POOL) t = criarTrabalhador();
    if (!t) return;

    const tarefa = /** @type {Tarefa} */ (fila.shift());
    const trabalhador = t;
    trabalhador.atual = tarefa;
    trabalhador.worker.ref();
    trabalhador.timer = setTimeout(() => {
      // Worker travado (loop infinito numa build com bug, por exemplo): mata e
      // recria no próximo despacho, em vez de deixar a fila parada para sempre.
      remover(trabalhador);
      concluir(trabalhador, new Error('VERIFIER_TIMEOUT'));
      trabalhador.worker.terminate();
    }, TEMPO_MAXIMO_MS);
    trabalhador.worker.postMessage(tarefa.job);
  }
}

/**
 * @param {{gameCode: number, seed: Uint8Array, loadout: Uint8Array, log: Uint8Array}} job
 * @returns {Promise<{ok: boolean, error?: string, result?: any, telemetry?: number[],
 *                    simVersion: number, ms: number}>}
 */
function verificar(job) {
  return new Promise((resolve, reject) => {
    if (fila.length >= maxFila()) {
      reject(new Error('VERIFIER_QUEUE_FULL'));
      return;
    }
    fila.push({ job, resolve, reject });
    despachar();
  });
}

/**
 * Gera uma partida autoritativa no mesmo worker do verificador. O cliente pode
 * reproduzir o log recebido, mas nunca escolhe a seed, a entrada ou o resultado.
 *
 * @param {{gameCode: number, seed: Uint8Array, loadout: Uint8Array, botSeed: number, skill?: number}} job
 */
function gerar(job) {
  return new Promise((resolve, reject) => {
    if (fila.length >= maxFila()) {
      reject(new Error('VERIFIER_QUEUE_FULL'));
      return;
    }
    fila.push({ job: { ...job, operacao: 'gerar' }, resolve, reject });
    despachar();
  });
}

async function encerrar() {
  await Promise.all(trabalhadores.splice(0).map((t) => t.worker.terminate()));
}

module.exports = { verificar, gerar, encerrar };
