/**
 * Leitura do buffer de render do Neon Drifter.
 *
 * Espelha NeonDrifter::render em games/sim/src/games/neon_drifter.rs — mudou lá,
 * muda aqui. Cabeçalho comum (shell/cabecalho.ts) com os nomes do Neon, depois a
 * lista de carros.
 */
import { H } from '../shell/cabecalho';

export const N = {
  ...H,
  /** Carga de neon, 0 a 100. */
  NEON: H.ANEIS,
  /** Ticks de nitro restantes. */
  NITRO: H.BOOST
} as const;

export type Carro = { x: number; z: number; batido: boolean };

/** Carros depois do cabeçalho: [n][x, z, batido] × n. */
export function lerTrafego(b: Float32Array): Carro[] {
  const n = b[H.FIM_CABECALHO] || 0;
  const carros = new Array<Carro>(n);
  for (let i = 0, o = H.FIM_CABECALHO + 1; i < n; i++, o += 3) {
    carros[i] = { x: b[o], z: b[o + 1], batido: b[o + 2] > 0 };
  }
  return carros;
}
