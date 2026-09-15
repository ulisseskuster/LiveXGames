/**
 * Simulação num Web Worker, a 60 ticks por segundo.
 *
 * Fora da thread principal porque a página da arena tem chat, mural e ranking
 * renderizando ao mesmo tempo: um soluço de layout ali não pode atrasar o tick.
 * O render interpola entre os dois últimos quadros recebidos (ver simHost.ts).
 */
import type { MensagemDoWorker, MensagemParaWorker } from './protocolo';
import { ATE_O_FIM, SimWasm, base64ParaBytes, hexParaBytes } from './simWasm';

const PASSO_MS = 1000 / 60;
/**
 * Teto de ticks por volta do laço. Aba travada por 2 s não pode virar 120 ticks
 * de uma vez: o jogador bateria sem ter visto nada. A simulação desacelera.
 */
const MAX_PASSOS_POR_VOLTA = 8;

const escopo = self as unknown as {
  postMessage(msg: MensagemDoWorker, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<MensagemParaWorker>) => void) | null;
};

let sim: SimWasm | null = null;
let handle = -1;
let pausado = false;
let terminado = false;
let acumulado = 0;
let ultimo = 0;
let intervalo: ReturnType<typeof setInterval> | null = null;
let entrada = { botoes: 0, ax: 0, ay: 0 };
let entradaMudou = false;
let velocidadeReproducao = 1;
let reproduzindo = false;

function enviar(msg: MensagemDoWorker, transfer: Transferable[] = []): void {
  escopo.postMessage(msg, transfer);
}

function parar(): void {
  terminado = true;
  if (intervalo) clearInterval(intervalo);
  intervalo = null;
}

function encerrar(): void {
  if (!sim || handle < 0) return;
  parar();
  const resultado = sim.resultado(handle);
  const log = sim.log(handle);
  const telemetria = sim.telemetria(handle);
  const render = sim.render(handle);
  const versao = sim.versao;
  sim.liberar(handle);
  handle = -1;
  enviar({ tipo: 'fim', versao, resultado, log, telemetria, render }, [
    log.buffer,
    telemetria.buffer,
    render.buffer
  ]);
}

function volta(): void {
  if (!sim || handle < 0 || pausado || terminado) return;
  const agora = performance.now();
  acumulado += Math.min(agora - ultimo, 250) * velocidadeReproducao;
  ultimo = agora;

  let passos = 0;
  let status = 0;
  while (acumulado >= PASSO_MS && passos < MAX_PASSOS_POR_VOLTA) {
    if (entradaMudou) {
      sim.entrada(handle, entrada.botoes, entrada.ax, entrada.ay);
      entradaMudou = false;
    }
    status = sim.avancar(handle, 1);
    acumulado -= PASSO_MS;
    passos++;
    if (status !== 0) break;
  }
  if (passos === MAX_PASSOS_POR_VOLTA) acumulado = Math.min(acumulado, PASSO_MS);

  if (status < 0) {
    parar();
    enviar({ tipo: 'erro', mensagem: `A simulação parou com erro (código ${status})` });
  } else if (status === 1) {
    encerrar();
  } else if (passos > 0) {
    const render = sim.render(handle);
    enviar({ tipo: 'quadro', tick: sim.resultado(handle).ticks, render }, [render.buffer]);
  }
}

escopo.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    switch (msg.tipo) {
      case 'preparar': {
        velocidadeReproducao = Math.max(1, Math.min(3, msg.velocidadeReproducao || 1));
        reproduzindo = Boolean(msg.replayLog);
        sim = await SimWasm.carregar(msg.wasmUrl);
        handle = msg.replayLog
          ? sim.replayPartida(
              msg.codigoJogo,
              hexParaBytes(msg.semente),
              base64ParaBytes(msg.loadout),
              base64ParaBytes(msg.replayLog)
            )
          : sim.novaPartida(
              msg.codigoJogo,
              hexParaBytes(msg.semente),
              base64ParaBytes(msg.loadout)
            );
        if (msg.botSemente !== undefined) sim.anexarBot(handle, msg.botSemente);
        if (msg.imediato) {
          sim.avancar(handle, ATE_O_FIM);
          encerrar();
          return;
        }
        const render = sim.render(handle);
        enviar({ tipo: 'pronto', versao: sim.versao, render }, [render.buffer]);
        break;
      }
      case 'comecar':
        if (intervalo || terminado) return;
        ultimo = performance.now();
        acumulado = 0;
        // 4 ms: o timer de worker é impreciso; um intervalo curto com acumulador
        // mantém a média em 60 ticks/s mesmo quando um disparo atrasa.
        intervalo = setInterval(volta, 4);
        break;
      case 'entrada':
        if (reproduzindo) break;
        entrada = { botoes: msg.botoes, ax: msg.ax, ay: msg.ay };
        entradaMudou = true;
        break;
      case 'pausa':
        pausado = msg.pausado;
        // Sem zerar o relógio, voltar da pausa descontaria o tempo parado de uma vez.
        if (!pausado) ultimo = performance.now();
        break;
      case 'sair':
        if (sim && handle >= 0 && !terminado) {
          sim.sair(handle);
          encerrar();
        }
        break;
    }
  } catch (err) {
    parar();
    enviar({ tipo: 'erro', mensagem: err instanceof Error ? err.message : String(err) });
  }
};
