import type { MensagemDoWorker, MensagemParaWorker } from './protocolo';
import type { ResultadoSim } from './simWasm';

export type FimDePartida = {
  versao: number;
  resultado: ResultadoSim;
  log: Uint8Array;
  telemetria: Float32Array;
};

export type Quadro = {
  anterior: Float32Array;
  atual: Float32Array;
  /** 0 = mostrar `anterior`, 1 = mostrar `atual`. */
  alfa: number;
  tick: number;
};

type OpcoesPreparo = {
  codigoJogo: number;
  semente: string;
  loadout: string;
  replayLog?: string | null;
  velocidadeReproducao?: number;
  botSemente?: number;
  imediato?: boolean;
};

const PASSO_MS = 1000 / 60;

/**
 * Lado da página: conversa com o worker da simulação e entrega ao render o par
 * de quadros para interpolar.
 */
export class SimHost {
  private readonly worker: Worker;
  private anterior: Float32Array | null = null;
  private atual: Float32Array | null = null;
  private recebidoEm = 0;
  private tick = 0;
  private ultimaEntrada = { botoes: -1, ax: 0, ay: 0 };
  private resolverPronto: ((versao: number) => void) | null = null;
  private resolverFim!: (fim: FimDePartida) => void;
  private rejeitarFim!: (erro: Error) => void;
  private rejeitarPronto: ((erro: Error) => void) | null = null;
  private readonly fim: Promise<FimDePartida>;
  versao = 0;

  constructor(private readonly wasmUrl: string = __SIM_WASM_URL__) {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.fim = new Promise((resolve, reject) => {
      this.resolverFim = resolve;
      this.rejeitarFim = reject;
    });
    // Sem isto, um erro antes de alguém aguardar terminou() viraria
    // "unhandled rejection" no console mesmo quando tratado depois.
    this.fim.catch(() => {});
    this.worker.onmessage = (ev: MessageEvent<MensagemDoWorker>) => this.receber(ev.data);
    this.worker.onerror = (ev) =>
      this.falhar(new Error(ev.message || 'Falha no worker da simulação'));
  }

  preparar(opcoes: OpcoesPreparo): Promise<number> {
    const pronto = new Promise<number>((resolve, reject) => {
      this.resolverPronto = resolve;
      this.rejeitarPronto = reject;
    });
    this.enviar({ tipo: 'preparar', wasmUrl: this.wasmUrl, ...opcoes });
    return pronto;
  }

  comecar(): void {
    this.enviar({ tipo: 'comecar' });
  }

  /** Só manda ao worker quando muda: 60 mensagens por segundo iguais não servem a nada. */
  definirEntrada(botoes: number, ax: number, ay: number): void {
    const u = this.ultimaEntrada;
    if (u.botoes === botoes && u.ax === ax && u.ay === ay) return;
    this.ultimaEntrada = { botoes, ax, ay };
    this.enviar({ tipo: 'entrada', botoes, ax, ay });
  }

  pausar(pausado: boolean): void {
    this.enviar({ tipo: 'pausa', pausado });
  }

  sair(): void {
    this.enviar({ tipo: 'sair' });
  }

  terminou(): Promise<FimDePartida> {
    return this.fim;
  }

  quadro(agora: number): Quadro | null {
    if (!this.atual) return null;
    return {
      anterior: this.anterior ?? this.atual,
      atual: this.atual,
      alfa: Math.min(1, Math.max(0, (agora - this.recebidoEm) / PASSO_MS)),
      tick: this.tick
    };
  }

  encerrar(): void {
    this.worker.terminate();
  }

  private enviar(msg: MensagemParaWorker): void {
    this.worker.postMessage(msg);
  }

  private guardarQuadro(render: Float32Array): void {
    this.anterior = this.atual;
    this.atual = render;
    this.recebidoEm = performance.now();
  }

  private receber(msg: MensagemDoWorker): void {
    switch (msg.tipo) {
      case 'pronto':
        this.versao = msg.versao;
        this.guardarQuadro(msg.render);
        this.resolverPronto?.(msg.versao);
        this.resolverPronto = null;
        break;
      case 'quadro':
        this.tick = msg.tick;
        this.guardarQuadro(msg.render);
        break;
      case 'fim':
        this.versao = msg.versao;
        this.tick = msg.resultado.ticks;
        this.guardarQuadro(msg.render);
        this.resolverPronto?.(msg.versao);
        this.resolverPronto = null;
        this.resolverFim({
          versao: msg.versao,
          resultado: msg.resultado,
          log: msg.log,
          telemetria: msg.telemetria
        });
        break;
      case 'erro':
        this.falhar(new Error(msg.mensagem));
        break;
    }
  }

  private falhar(erro: Error): void {
    this.rejeitarPronto?.(erro);
    this.rejeitarPronto = null;
    this.resolverPronto = null;
    this.rejeitarFim(erro);
  }
}
