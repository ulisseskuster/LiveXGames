import type * as THREE from 'three/webgpu';
import { Audio } from './audio';
import { SimHost, type Quadro } from './simHost';
import { criarRenderer, QualidadeAdaptativa } from './renderer';
import { CinemaHud } from './cinemaHud';
import { CinemaScene, type VisualCinema } from './cinemaScene';
import { H } from './cabecalho';

type Cena = CinemaScene & { atualizar(q: Quadro, now: number): void };
export type OpcoesCinema = {
  semente: string;
  loadout: string;
  replayLog?: string | null;
  scoreMultiplier?: number;
  subscriberMultiplier?: number;
  ticks?: number;
};

/** Ciclo compartilhado de reprodução. Não instala teclado/gamepad de pilotagem. */
export class Cinema {
  private readonly palco = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly audio: Audio;
  private ultimoBoost = 0;
  private ultimoCasco = 3;
  private readonly hud: CinemaHud;
  private host: SimHost | null = null;
  private cena: Cena | null = null;
  private renderer: THREE.WebGPURenderer | null = null;
  private qualidade: QualidadeAdaptativa | null = null;
  private raf = 0;
  private morto = false;
  private visivel = true;
  private ultimo = 0;
  private readonly observer: IntersectionObserver;
  private readonly pausa = () => this.host?.pausar(document.hidden);
  private readonly escape = (e: KeyboardEvent) => {
    if (e.code === 'Escape') this.sair();
  };
  private parado: Quadro;
  constructor(
    container: HTMLElement,
    private codigo: number,
    private modo: 'neon' | 'void'
  ) {
    this.audio = new Audio(modo);
    this.palco.className = `jl-palco cinema-palco cinema-palco--${modo}`;
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute(
      'aria-label',
      modo === 'neon'
        ? 'Neon Drifter — reprodução da corrida'
        : 'Void Walker — reprodução da expedição'
    );
    this.palco.append(this.canvas);
    container.append(this.palco);
    this.hud = new CinemaHud(this.palco, modo, () => this.sair());
    const b = new Float32Array(35);
    b[H.Y] = modo === 'void' ? 18 : 0.6;
    b[H.VELOCIDADE] = 0;
    b[H.CASCO] = 3;
    b[H.COMBUSTIVEL] = 100;
    b[H.FASE] = 1;
    this.parado = { anterior: b, atual: b, alfa: 1, tick: -1 };
    this.observer = new IntersectionObserver(
      (entries) => (this.visivel = entries.some((e) => e.isIntersecting))
    );
    this.observer.observe(this.palco);
    window.addEventListener('keydown', this.escape);
    document.addEventListener('visibilitychange', this.pausa);
  }
  async montar(
    C: new (r: THREE.WebGPURenderer, c: HTMLCanvasElement, v: VisualCinema) => Cena,
    visual: Omit<VisualCinema, 'bloom'>,
    webgl: boolean
  ) {
    try {
      this.renderer = await criarRenderer(this.canvas, webgl);
      this.qualidade = new QualidadeAdaptativa(this.renderer);
      this.cena = new C(this.renderer, this.canvas, {
        ...visual,
        bloom: !matchMedia('(pointer: coarse)').matches
      });
      this.cena.atualizar(this.parado, performance.now());
      await this.cena.aquecer();
      this.raf = requestAnimationFrame(this.loop);
    } catch (e) {
      this.destruir();
      throw e;
    }
  }
  async jogar(op: OpcoesCinema) {
    if (this.host || this.morto) throw new Error('Reprodução indisponível');
    this.audio.iniciar();
    this.ultimoBoost = 0;
    this.ultimoCasco = 3;
    const h = new SimHost();
    this.host = h;
    try {
      // Tempo real: o filme dura o mesmo que a rodada (15–20 s) e pode ser pulado.
      await h.preparar({
        codigoJogo: this.codigo,
        semente: op.semente,
        loadout: op.loadout,
        replayLog: op.replayLog,
        botSemente: op.replayLog ? undefined : 127
      });
      this.hud.preparar(op.scoreMultiplier, op.ticks, !op.replayLog, op.subscriberMultiplier);
      // O cabeçalho fixo cresce no celular; focus/scrollIntoView sozinhos deixam
      // metade do filme escondida atrás dele.
      const topo = document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0;
      const retangulo = this.palco.getBoundingClientRect();
      if (retangulo.top < topo + 12 || retangulo.bottom > window.innerHeight) {
        window.scrollBy({ top: retangulo.top - topo - 16, behavior: 'instant' });
      }
      this.canvas.focus({ preventScroll: true });
      h.comecar();
      const fim = await h.terminou();
      this.parado = h.quadro(performance.now()) ?? this.parado;
      this.audio.vitoria();
      return fim;
    } finally {
      h.encerrar();
      this.host = null;
      this.hud.terminar();
      this.audio.motor(0, 1, false);
    }
  }
  private loop = (now: number) => {
    if (this.morto) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.ultimo ? now - this.ultimo : 16;
    this.ultimo = now;
    const q = this.host?.quadro(now) ?? this.parado;
    this.hud.atualizar(q.atual, q.tick);
    if (this.host) {
      this.audio.motor(Math.min(1, q.atual[H.VELOCIDADE] / 110), 1, !document.hidden);
      if (q.atual[H.BOOST] > 0 && this.ultimoBoost <= 0) {
        if (this.modo === 'void') this.audio.anel();
        else this.audio.nitro();
      }
      if (q.atual[H.CASCO] < this.ultimoCasco) this.audio.batida();
      this.ultimoBoost = q.atual[H.BOOST];
      this.ultimoCasco = q.atual[H.CASCO];
    }
    if (!this.visivel || document.hidden) return;
    this.cena?.atualizar(q, now);
    this.cena?.desenhar();
    this.qualidade?.registrar(dt);
  };
  sair() {
    this.host?.sair();
  }
  get emPartida() {
    return this.host !== null;
  }
  get temRender() {
    return this.cena !== null;
  }
  destruir() {
    this.morto = true;
    cancelAnimationFrame(this.raf);
    this.host?.sair();
    this.host?.encerrar();
    this.host = null;
    this.observer.disconnect();
    window.removeEventListener('keydown', this.escape);
    document.removeEventListener('visibilitychange', this.pausa);
    this.audio.encerrar();
    this.hud.destruir();
    this.cena?.destruir();
    this.renderer?.dispose();
    this.palco.remove();
  }
}
