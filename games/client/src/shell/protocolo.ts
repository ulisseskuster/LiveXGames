import type { ResultadoSim } from './simWasm';

/** Mensagens entre a página e o worker da simulação. */

export type MensagemParaWorker =
  | {
      tipo: 'preparar';
      wasmUrl: string;
      codigoJogo: number;
      /** Semente em hex, como o servidor emite. */
      semente: string;
      /** Loadout codificado pelo servidor, em base64 ('' = sem itens). */
      loadout: string;
      /** Log autoritativo gerado pelo servidor. Quando presente, não há entrada local. */
      replayLog?: string | null;
      velocidadeReproducao?: number;
      botSemente?: number;
      /** Joga até o fim na hora, sem relógio (autoteste de determinismo). */
      imediato?: boolean;
    }
  | { tipo: 'comecar' }
  | { tipo: 'entrada'; botoes: number; ax: number; ay: number }
  | { tipo: 'pausa'; pausado: boolean }
  | { tipo: 'sair' };

export type MensagemDoWorker =
  | { tipo: 'pronto'; versao: number; render: Float32Array }
  | { tipo: 'quadro'; tick: number; render: Float32Array }
  | {
      tipo: 'fim';
      versao: number;
      resultado: ResultadoSim;
      log: Uint8Array;
      telemetria: Float32Array;
      render: Float32Array;
    }
  | { tipo: 'erro'; mensagem: string };
