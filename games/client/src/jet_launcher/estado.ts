/**
 * Leitura do buffer de render do Jet Launcher.
 *
 * Espelha JetLauncher::render em games/sim/src/games/jet_launcher.rs — mudou lá,
 * muda aqui. O cabeçalho é o comum dos três jogos (shell/cabecalho.ts); depois
 * dele vêm as listas de entidades do Jet.
 */
import { H } from '../shell/cabecalho';

export { H, temEvento } from '../shell/cabecalho';

/** Bits de H.EVENTOS. Códigos EV_* da crate. */
export const EVENTO = {
  ROLAGEM: 1,
  QUASE_COLISAO: 2,
  ANEL: 3,
  TRAVA_MISSIL: 4,
  NITRO: 5,
  FLARES: 6,
  DRONES_ABATIDOS: 7,
  ESCUDO: 8,
  BATIDA: 9,
  ESQUIVA_PERFEITA: 10,
  SCRAMJET: 11,
  SEM_COMBUSTIVEL: 12,
  FASE_COMBATE: 14,
  FASE_SUBORBITAL: 15,
  FIM: 16
} as const;

export const ROLL_TICKS = 18;
export const ROLL_COOLDOWN = 90;

export type Predio = { x: number; z: number; hw: number; hd: number; h: number };
export type Anel = { x: number; y: number; z: number; r: number; passou: boolean };
export type Drone = { x: number; y: number; z: number };
export type Missil = { x: number; y: number; z: number; travando: boolean; guiado: boolean };
export type Detrito = { x: number; y: number; z: number; r: number };

export type Entidades = {
  predios: Predio[];
  aneis: Anel[];
  drones: Drone[];
  misseis: Missil[];
  detritos: Detrito[];
};

/**
 * Lê as listas de entidades do fim do buffer. Chamado uma vez por quadro
 * recebido (60/s), não a cada quadro de tela: as listas não são interpoladas.
 */
export function lerEntidades(b: Float32Array): Entidades {
  let i: number = H.FIM_CABECALHO;
  const lista = <T>(tamanho: number, ler: (o: number) => T): T[] => {
    const n = b[i++];
    const saida: T[] = new Array(n);
    for (let k = 0; k < n; k++, i += tamanho) saida[k] = ler(i);
    return saida;
  };
  return {
    predios: lista(5, (o) => ({ x: b[o], z: b[o + 1], hw: b[o + 2], hd: b[o + 3], h: b[o + 4] })),
    aneis: lista(5, (o) => ({ x: b[o], y: b[o + 1], z: b[o + 2], r: b[o + 3], passou: b[o + 4] > 0 })),
    drones: lista(3, (o) => ({ x: b[o], y: b[o + 1], z: b[o + 2] })),
    misseis: lista(5, (o) => ({
      x: b[o],
      y: b[o + 1],
      z: b[o + 2],
      travando: b[o + 3] > 0,
      guiado: b[o + 4] > 0
    })),
    detritos: lista(4, (o) => ({ x: b[o], y: b[o + 1], z: b[o + 2], r: b[o + 3] }))
  };
}
