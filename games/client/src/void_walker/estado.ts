/**
 * Leitura do buffer de render do Void Walker.
 *
 * Espelha VoidWalker::render em games/sim/src/games/void_walker.rs — mudou lá,
 * muda aqui. Cabeçalho comum (shell/cabecalho.ts) com os nomes do Void, depois as
 * listas de asteroides e de planetas.
 */
import { H } from '../shell/cabecalho';

export const V = {
  ...H,
  /** Quanto da expedição já passou, 0 a 100 (aproxima a singularidade). */
  PROGRESSO: H.ANEIS,
  /** Ticks segurando a âncora gravitacional. */
  ESTILINGUE: H.BOOST
} as const;

export type Asteroide = { x: number; y: number; z: number; r: number };
export type Planeta = { x: number; y: number; z: number; r: number; massa: number };

/** [n][x, y, z, r] × n asteroides, depois [n][x, y, z, r, massa] × n planetas. */
export function lerEspaco(b: Float32Array): { asteroides: Asteroide[]; planetas: Planeta[] } {
  let o: number = H.FIM_CABECALHO;
  const na = b[o++] || 0;
  const asteroides = new Array<Asteroide>(na);
  for (let i = 0; i < na; i++, o += 4) {
    asteroides[i] = { x: b[o], y: b[o + 1], z: b[o + 2], r: b[o + 3] };
  }
  const np = b[o++] || 0;
  const planetas = new Array<Planeta>(np);
  for (let i = 0; i < np; i++, o += 5) {
    planetas[i] = { x: b[o], y: b[o + 1], z: b[o + 2], r: b[o + 3], massa: b[o + 4] };
  }
  return { asteroides, planetas };
}
