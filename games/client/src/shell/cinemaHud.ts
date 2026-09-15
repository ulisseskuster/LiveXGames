import estilo from './cinemaHud.css?inline';
import { H } from './cabecalho';

let pronto = false;
const numero = (n: number) => Math.round(n).toLocaleString('pt-BR');
/** Duração máxima de uma rodada, em ticks (DURACAO_MAX_TICKS da crate). */
const TICKS_MAXIMOS = 20 * 60;
export class CinemaHud {
  readonly raiz = document.createElement('div');
  private readonly fase: HTMLElement;
  private readonly score: HTMLElement;
  private readonly velocidade: HTMLElement;
  private readonly distancia: HTMLElement;
  private readonly barra: HTMLElement;
  private readonly bonus: HTMLElement;
  private readonly estado: HTMLElement;
  private readonly pular: HTMLButtonElement;
  private multiplier = 1;
  private total = TICKS_MAXIMOS;
  constructor(
    parent: HTMLElement,
    private modo: 'neon' | 'void',
    sair: () => void
  ) {
    if (!pronto) {
      const style = document.createElement('style');
      style.textContent = estilo;
      document.head.append(style);
      pronto = true;
    }
    this.raiz.dataset.estado = 'pronto';
    this.raiz.className = `cinema-hud cinema-hud--${modo} ${modo === 'neon' ? 'nd-hud' : 'vw-hud'}`;
    // Somente texto estático: nomes de itens e resultados entram por textContent.
    this.raiz.innerHTML = `<div class="cinema-heading"><span class="cinema-kicker">${modo === 'neon' ? 'LUNA VEX / NIGHT DIVISION' : 'ZARA + BOB / DEEP SPACE'}</span><strong>${modo === 'neon' ? 'NEON DRIFTER' : 'VOID WALKER'}</strong><span class="cinema-phase"></span></div><div class="cinema-score"><small>PONTUAÇÃO</small><strong>0</strong><span class="cinema-bonus"></span></div><div class="cinema-bottom"><div class="cinema-readout"><strong class="cinema-speed">0</strong><span>${modo === 'neon' ? 'KM/H' : 'DOBRA'}</span></div><div class="cinema-distance"></div><button type="button" class="ghost-btn cinema-skip" hidden>Ver resultado <span>↗</span></button></div><div class="cinema-timeline"><i></i></div><div class="cinema-state">RODADA AUTOMÁTICA • EQUIPE E ACOMPANHE</div>`;
    parent.append(this.raiz);
    this.fase = this.raiz.querySelector('.cinema-phase')!;
    this.score = this.raiz.querySelector('.cinema-score strong')!;
    this.velocidade = this.raiz.querySelector('.cinema-speed')!;
    this.distancia = this.raiz.querySelector('.cinema-distance')!;
    this.barra = this.raiz.querySelector('.cinema-timeline i')!;
    this.bonus = this.raiz.querySelector('.cinema-bonus')!;
    this.estado = this.raiz.querySelector('.cinema-state')!;
    this.pular = this.raiz.querySelector('.cinema-skip')!;
    this.pular.addEventListener('click', sair);
  }
  preparar(multiplier = 1, total = TICKS_MAXIMOS, demo = false, subscriberMultiplier = 1) {
    this.raiz.dataset.estado = 'reproduzindo';
    this.multiplier = multiplier;
    this.total = total;
    this.bonus.textContent =
      multiplier > 1
        ? `×${multiplier.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} PONTOS${subscriberMultiplier > 1 ? ' • SUB +20%' : ''}`
        : 'SEM MULTIPLICADOR';
    this.estado.textContent = demo ? 'DEMONSTRAÇÃO • SEM RECOMPENSAS' : 'REPRODUÇÃO DA MISSÃO';
    this.pular.hidden = false;
  }
  atualizar(b: Float32Array, tick: number) {
    const fase = Math.max(0, Math.min(2, Math.round(b[H.FASE]) - 1));
    this.fase.textContent = (
      this.modo === 'neon'
        ? ['01 / DISTRITO NOTURNO', '02 / INTERCEPTAÇÃO', '03 / OVERDRIVE']
        : ['01 / ALÉM DA ÓRBITA', '02 / CINTURÃO PERDIDO', '03 / HORIZONTE DE EVENTOS']
    )[fase];
    this.score.textContent = numero(b[H.SCORE] * this.multiplier);
    this.velocidade.textContent = numero(b[H.VELOCIDADE] * (this.modo === 'neon' ? 3.6 : 1));
    this.distancia.textContent = `${(b[H.Z] / 1000).toFixed(2)} ${this.modo === 'neon' ? 'KM PERCORRIDOS' : 'AL EXPLORADOS'}`;
    this.barra.style.transform = `scaleX(${Math.max(0, Math.min(1, tick / this.total))})`;
  }
  terminar() {
    this.raiz.dataset.estado = 'concluido';
    this.pular.hidden = true;
    this.estado.textContent = 'RODADA CONCLUÍDA';
  }
  destruir() {
    this.raiz.remove();
  }
}
