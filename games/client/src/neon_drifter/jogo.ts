import { Cinema } from '../shell/cinema';
import { CenaNeon, type Visual } from './cena';
export const CODIGO_NEON = 2;
export class JogoNeon extends Cinema {
  static async criar(container: HTMLElement, visual: Omit<Visual, 'bloom'>, forcarWebGL = false) {
    const jogo = new JogoNeon(container, CODIGO_NEON, 'neon');
    await jogo.montar(CenaNeon, visual, forcarWebGL);
    return jogo;
  }
}
