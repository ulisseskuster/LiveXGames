import { Cinema } from '../shell/cinema';
import { CenaVoid, type Visual } from './cena';
export const CODIGO_VOID = 3;
export class JogoVoid extends Cinema {
  static async criar(container: HTMLElement, visual: Omit<Visual, 'bloom'>, forcarWebGL = false) {
    const jogo = new JogoVoid(container, CODIGO_VOID, 'void');
    await jogo.montar(CenaVoid, visual, forcarWebGL);
    return jogo;
  }
}
