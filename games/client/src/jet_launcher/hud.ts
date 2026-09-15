import estilo from './hud.css?inline';
import { EVENTO, H, temEvento } from './estado';

/**
 * HUD do Jet Launcher, em DOM sobre o canvas.
 *
 * Números com textContent (nunca innerHTML: os nomes de item vêm do servidor) e
 * só quando mudam — escrever no DOM a 60 Hz sem necessidade força layout e rouba
 * o tempo de quadro que o WebGPU precisa.
 */

type Tom = 'bom' | 'ruim' | 'ouro';

const MENSAGENS: Record<number, [string, Tom]> = {
  [EVENTO.ANEL]: ['Anel supersônico!', 'bom'],
  [EVENTO.NITRO]: ['NITRO!', 'ouro'],
  [EVENTO.FLARES]: ['Flares: trava quebrada!', 'bom'],
  [EVENTO.DRONES_ABATIDOS]: ['Pulso EMP: drones abatidos!', 'bom'],
  [EVENTO.ESCUDO]: ['Escudo absorveu o impacto!', 'bom'],
  [EVENTO.BATIDA]: ['Impacto no casco!', 'ruim'],
  [EVENTO.ESQUIVA_PERFEITA]: ['ESQUIVA PERFEITA', 'ouro'],
  [EVENTO.SCRAMJET]: ['Scramjet aceso: Mach 5!', 'ouro'],
  [EVENTO.SEM_COMBUSTIVEL]: ['Tanque seco!', 'ruim'],
  [EVENTO.QUASE_COLISAO]: ['Por um fio!', 'bom']
};

const FASES: Record<number, string> = {
  [EVENTO.FASE_COMBATE]: 'ZONA DE COMBATE',
  [EVENTO.FASE_SUBORBITAL]: 'SUBIDA SUBORBITAL'
};

let estiloInjetado = false;

function injetarEstilo(): void {
  if (estiloInjetado) return;
  const el = document.createElement('style');
  el.dataset.origem = 'livex-jet-launcher';
  el.textContent = estilo;
  document.head.append(el);
  estiloInjetado = true;
}

function criar<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classe: string,
  pai: HTMLElement
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = classe;
  pai.append(el);
  return el;
}

function dado(pai: HTMLElement, rotulo: string, classe = 'jl-dado'): HTMLElement {
  const caixa = criar('div', classe, pai);
  criar('span', '', caixa).textContent = rotulo;
  return criar('b', '', caixa);
}

export class HudJet {
  readonly raiz: HTMLDivElement;
  private readonly distancia: HTMLElement;
  private readonly velocidade: HTMLElement;
  private readonly altitude: HTMLElement;
  private readonly score: HTMLElement;
  private readonly aneis: HTMLElement;
  private readonly casco: HTMLDivElement;
  private readonly barra: HTMLDivElement;
  private readonly aviso: HTMLDivElement;
  private readonly toasts: HTMLDivElement;
  private readonly fase: HTMLDivElement;
  private readonly bullet: HTMLDivElement;
  private readonly botaoPular: HTMLButtonElement;
  private multiplier = 1;
  private total = 1200;
  private readonly status: HTMLElement;
  private readonly bonus: HTMLElement;
  private ultimo: Record<string, string> = {};

  constructor(pai: HTMLElement, sair: () => void) {
    injetarEstilo();
    this.raiz = criar('div', 'jl-hud', pai);
    const identidade = criar('div', 'jl-identidade', this.raiz);
    criar('span', '', identidade).textContent = 'CAPITÃO ORION / SKY DIVISION';
    criar('strong', '', identidade).textContent = 'JET LAUNCHER';
    this.bonus = criar('small', '', identidade);
    this.bullet = criar('div', 'jl-bullet', this.raiz);
    this.bullet.hidden = true;

    const esq = criar('div', 'jl-canto jl-esq', this.raiz);
    this.distancia = dado(esq, 'DISTÂNCIA');
    this.velocidade = dado(esq, 'VELOCIDADE');
    this.altitude = dado(esq, 'ALTITUDE');

    const dir = criar('div', 'jl-canto jl-dir', this.raiz);
    this.score = dado(dir, 'PONTUAÇÃO', 'jl-dado jl-score');
    this.aneis = dado(dir, 'ANÉIS');

    const baixo = criar('div', 'jl-baixo', this.raiz);
    this.casco = criar('div', 'jl-casco', baixo);
    this.casco.hidden = true;
    this.status = criar('span', 'jl-status', this.raiz);
    this.status.textContent = '';
    const combustivel = criar('div', 'jl-combustivel', baixo);
    this.barra = criar('div', 'jl-barra', combustivel);

    this.aviso = criar('div', 'jl-aviso', this.raiz);
    this.aviso.textContent = '⚠ MÍSSIL TRAVADO';
    this.aviso.hidden = true;
    this.toasts = criar('div', 'jl-toasts', this.raiz);
    this.fase = criar('div', 'jl-fase', this.raiz);
    this.fase.hidden = true;

    // Mesmo texto e mesma classe base do botão do Neon e do Void.
    this.botaoPular = criar('button', 'ghost-btn jl-pular', this.raiz);
    this.botaoPular.type = 'button';
    this.botaoPular.textContent = 'Ver resultado ↗';
    this.botaoPular.hidden = true;
    this.botaoPular.addEventListener('click', sair);
    this.visivel(false);
  }

  preparar(multiplier = 1, subscriberMultiplier = 1, total = 1200, demo = false): void {
    this.total = total;
    this.toasts.replaceChildren();
    this.status.textContent = demo ? 'DEMONSTRAÇÃO • SEM RECOMPENSAS' : 'REPRODUÇÃO DA MISSÃO';
    this.multiplier = multiplier;
    this.bonus.textContent =
      multiplier > 1
        ? `×${multiplier.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} PONTOS${subscriberMultiplier > 1 ? ' • SUB +20%' : ''}`
        : 'MISSÃO AUTOMÁTICA';
  }

  visivel(sim: boolean): void {
    for (const el of [this.distancia, this.score].map((e) => e.closest('.jl-canto'))) {
      if (el instanceof HTMLElement) el.hidden = !sim;
    }
    const baixo = this.casco.parentElement;
    if (baixo) baixo.hidden = !sim;
  }

  pular(visivel: boolean): void {
    this.botaoPular.hidden = !visivel;
  }

  private escrever(chave: string, el: HTMLElement, valor: string): void {
    if (this.ultimo[chave] === valor) return;
    this.ultimo[chave] = valor;
    el.textContent = valor;
  }

  atualizar(b: Float32Array, tick: number): void {
    const km = b[H.Z] / 1000;
    this.escrever('dist', this.distancia, km < 10 ? `${km.toFixed(2)} km` : `${km.toFixed(1)} km`);
    this.escrever('vel', this.velocidade, `${Math.round(b[H.VELOCIDADE] * 3.6)} km/h`);
    const alt = b[H.ALTITUDE];
    this.escrever(
      'alt',
      this.altitude,
      alt < 1000 ? `${Math.round(alt)} m` : `${(alt / 1000).toFixed(1)} km`
    );
    this.escrever(
      'score',
      this.score,
      Math.round(b[H.SCORE] * this.multiplier).toLocaleString('pt-BR')
    );
    this.escrever('aneis', this.aneis, String(b[H.ANEIS]));

    const casco = String(b[H.CASCO]);
    if (this.ultimo.casco !== casco) {
      this.ultimo.casco = casco;
      this.casco.replaceChildren(
        ...[0, 1, 2].map((i) => {
          const pip = document.createElement('i');
          if (i >= b[H.CASCO]) pip.className = 'vazio';
          return pip;
        })
      );
    }

    this.barra.style.transform = `scaleX(${Math.max(0, Math.min(1, tick / this.total))})`;

    this.aviso.hidden = b[H.AVISO_MISSIL] <= 0 || b[H.FLARES] > 0;
    this.bullet.hidden = b[H.BULLET_TIME] <= 0;
  }

  /** Chamado uma vez por tick novo da simulação. */
  eventos(b: Float32Array): void {
    for (const [codigo, [texto, tom]] of Object.entries(MENSAGENS)) {
      if (temEvento(b, Number(codigo))) this.toast(texto, tom);
    }
    for (const [codigo, texto] of Object.entries(FASES)) {
      if (temEvento(b, Number(codigo))) {
        this.fase.hidden = false;
        this.fase.textContent = texto;
        // Reinicia a animação: remover e recolocar a classe no mesmo quadro não basta.
        this.fase.style.animation = 'none';
        void this.fase.offsetWidth;
        this.fase.style.animation = '';
      }
    }
  }

  toast(texto: string, tom: Tom): void {
    // Um evento persistente no buffer não deve empilhar a mesma mensagem.
    if (Array.from(this.toasts.children).some((el) => el.textContent === texto)) return;
    const el = document.createElement('div');
    el.className = `jl-toast ${tom}`;
    el.textContent = texto;
    this.toasts.prepend(el);
    while (this.toasts.childElementCount > 3) this.toasts.lastElementChild?.remove();
    setTimeout(() => el.remove(), 1400);
  }

  destruir(): void {
    this.raiz.remove();
  }
}
