/**
 * Uma camada de entrada para teclado, controle (Gamepad API) e toque.
 *
 * Os bits espelham games/sim/src/engine/input.rs. O jogo nunca sabe de onde veio
 * a entrada — só vê botões e dois eixos de -127 a 127.
 */

export const BOTAO = {
  A: 1 << 0,
  B: 1 << 1,
  USAR_ITEM: 1 << 2,
  TROCAR_ITEM: 1 << 3,
  ACELERAR: 1 << 4,
  FREAR: 1 << 5
} as const;

export type Entrada = { botoes: number; ax: number; ay: number };

const TECLAS_DE_JOGO = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'KeyA',
  'KeyD',
  'KeyW',
  'KeyS',
  'Space',
  'ShiftLeft',
  'ShiftRight',
  'KeyE',
  'KeyQ',
  'ControlLeft'
]);

/** Analógico em repouso nunca marca 0 exato; sem zona morta a nave anda sozinha. */
const ZONA_MORTA = 0.18;
/** Arrasto, em pixels, que leva o eixo do toque ao máximo. */
const CURSO_TOQUE_PX = 70;

const limitar = (v: number) => Math.max(-1, Math.min(1, v));

export class Controles {
  /** Só captura teclas com a partida rodando: fora dela, setas e espaço rolam a página. */
  ativo = false;
  private readonly pressionadas = new Set<string>();
  private toqueEixo = 0;
  private toqueBotoes = 0;
  private origemToque: { id: number; x: number } | null = null;

  constructor(areaDeToque?: HTMLElement | null) {
    window.addEventListener('keydown', (e) => {
      if (!this.ativo || !TECLAS_DE_JOGO.has(e.code)) return;
      e.preventDefault();
      this.pressionadas.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.pressionadas.delete(e.code));
    // Soltar a tecla com a janela sem foco não dispara keyup: sem isto a nave
    // seguiria virando depois de um alt-tab.
    window.addEventListener('blur', () => this.pressionadas.clear());
    if (areaDeToque) this.ligarToque(areaDeToque);
  }

  ler(): Entrada {
    const k = (codigo: string) => this.pressionadas.has(codigo);
    let x = 0;
    let y = 0;
    let botoes = 0;

    if (k('ArrowLeft') || k('KeyA')) x -= 1;
    if (k('ArrowRight') || k('KeyD')) x += 1;
    if (k('ArrowUp') || k('KeyW')) y += 1;
    if (k('ArrowDown') || k('KeyS')) y -= 1;
    if (k('Space')) botoes |= BOTAO.A;
    if (k('ShiftLeft') || k('ShiftRight')) botoes |= BOTAO.B;
    if (k('KeyE')) botoes |= BOTAO.USAR_ITEM;
    if (k('KeyQ')) botoes |= BOTAO.TROCAR_ITEM;
    if (k('KeyW') || k('ArrowUp')) botoes |= BOTAO.ACELERAR;
    if (k('KeyS') || k('ArrowDown') || k('ControlLeft')) botoes |= BOTAO.FREAR;

    const pad = this.primeiroControle();
    if (pad) {
      const gx = pad.axes[0] ?? 0;
      const gy = -(pad.axes[1] ?? 0);
      if (Math.abs(gx) > ZONA_MORTA && Math.abs(gx) > Math.abs(x)) x = gx;
      if (Math.abs(gy) > ZONA_MORTA && Math.abs(gy) > Math.abs(y)) y = gy;
      const b = (i: number) => Boolean(pad.buttons[i]?.pressed);
      if (b(14)) x = -1;
      if (b(15)) x = 1;
      if (b(0)) botoes |= BOTAO.A;
      if (b(1)) botoes |= BOTAO.B;
      if (b(2)) botoes |= BOTAO.USAR_ITEM;
      if (b(4)) botoes |= BOTAO.TROCAR_ITEM;
      if (b(7)) botoes |= BOTAO.ACELERAR;
      if (b(6)) botoes |= BOTAO.FREAR;
    }

    if (Math.abs(this.toqueEixo) > Math.abs(x)) x = this.toqueEixo;
    botoes |= this.toqueBotoes;

    return {
      botoes,
      ax: Math.round(limitar(x) * 127),
      ay: Math.round(limitar(y) * 127)
    };
  }

  private primeiroControle(): Gamepad | null {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const pad of pads) if (pad && pad.connected) return pad;
    return null;
  }

  /**
   * `[data-zona="eixo"]` é o joystick virtual (arrastar na horizontal);
   * `[data-botao="A|B|USAR_ITEM|..."]` são botões que valem enquanto pressionados.
   */
  private ligarToque(area: HTMLElement): void {
    const eixo = area.querySelector<HTMLElement>('[data-zona="eixo"]');
    if (eixo) {
      eixo.addEventListener('pointerdown', (e) => {
        this.origemToque = { id: e.pointerId, x: e.clientX };
        eixo.setPointerCapture(e.pointerId);
      });
      eixo.addEventListener('pointermove', (e) => {
        if (this.origemToque?.id !== e.pointerId) return;
        this.toqueEixo = limitar((e.clientX - this.origemToque.x) / CURSO_TOQUE_PX);
      });
      const soltar = (e: PointerEvent) => {
        if (this.origemToque?.id !== e.pointerId) return;
        this.origemToque = null;
        this.toqueEixo = 0;
      };
      eixo.addEventListener('pointerup', soltar);
      eixo.addEventListener('pointercancel', soltar);
    }

    area.querySelectorAll<HTMLElement>('[data-botao]').forEach((el) => {
      const nome = el.dataset.botao as keyof typeof BOTAO;
      const bit = BOTAO[nome];
      if (!bit) return;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.toqueBotoes |= bit;
        if (typeof navigator.vibrate === 'function') navigator.vibrate(8);
      });
      const soltar = () => {
        this.toqueBotoes &= ~bit;
      };
      el.addEventListener('pointerup', soltar);
      el.addEventListener('pointerleave', soltar);
      el.addEventListener('pointercancel', soltar);
    });
  }
}
