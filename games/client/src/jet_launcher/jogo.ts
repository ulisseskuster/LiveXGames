import type * as THREE from 'three/webgpu';
import { Audio } from '../shell/audio';
import { QualidadeAdaptativa, criarRenderer } from '../shell/renderer';
import { SimHost, type FimDePartida, type Quadro } from '../shell/simHost';
import { CenaJet, type Visual } from './cena';
import { EVENTO, H, temEvento } from './estado';
import { HudJet } from './hud';

export const CODIGO_JET = 1;

export type OpcoesPartida = {
  /** Semente em hex (a do servidor quando a partida vale). */
  semente: string;
  /** Loadout codificado pelo servidor em base64 ('' sem itens). */
  loadout: string;
  /** Quando presente, a partida é uma reprodução autoritativa do servidor. */
  replayLog?: string | null;
  scoreMultiplier?: number;
  subscriberMultiplier?: number;
  ticks?: number;
};

const reduzirMovimento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Buffer de render de "jato parado na pista", antes da primeira partida. */
function quadroOcioso(): Quadro {
  const b = new Float32Array(H.FIM_CABECALHO + 5);
  b[H.Y] = 40;
  b[H.VELOCIDADE] = 72;
  b[H.CASCO] = 3;
  b[H.COMBUSTIVEL] = 100;
  b[H.FASE] = 1;
  b[H.ESCALA_TEMPO] = 1;
  b[H.SELECIONADO] = 0;
  b[H.CARGAS] = -1;
  b[H.CARGAS + 1] = -1;
  b[H.CARGAS + 2] = -1;
  b[H.ALTITUDE] = 40;
  return { anterior: b, atual: b, alfa: 1, tick: -1 };
}

/**
 * Uma instância do Jet Launcher montada num contêiner da página.
 *
 * Reproduz o filme de uma rodada a partir da semente, do loadout e do log do
 * servidor, e devolve o que a simulação produziu. Não fala com a API: quem abre e
 * liquida a rodada no servidor é o chamador (ver embed/main.ts).
 */
export class JogoJet {
  private readonly palco: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly hud: HudJet;
  private readonly audio = new Audio();
  private renderer: THREE.WebGPURenderer | null = null;
  private cena: CenaJet | null = null;
  private qualidade: QualidadeAdaptativa | null = null;
  private host: SimHost | null = null;
  private quadroParado: Quadro = quadroOcioso();
  private ultimoTick = -1;
  private ultimoAgora = performance.now();
  private raf = 0;
  private destruido = false;
  private visivelNaTela = true;
  private readonly observador: IntersectionObserver;
  private readonly aoTeclar = (e: KeyboardEvent) => {
    if (e.code === 'Escape' && this.host) this.host.sair();
  };
  private readonly aoTrocarAba = () => this.host?.pausar(document.hidden);

  private constructor(
    container: HTMLElement,
    private visual: Omit<Visual, 'bloom'>
  ) {
    this.palco = document.createElement('div');
    this.palco.className = 'jl-palco';
    this.canvas = document.createElement('canvas');
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Jet Launcher — reprodução do voo');
    this.palco.append(this.canvas);
    container.append(this.palco);
    this.hud = new HudJet(this.palco, () => this.sair());

    // Fora da tela (outra aba da Arena) o jogo não desenha nada.
    this.observador = new IntersectionObserver((entradas) => {
      this.visivelNaTela = entradas.some((e) => e.isIntersecting);
    });
    this.observador.observe(this.palco);
    window.addEventListener('keydown', this.aoTeclar);
    document.addEventListener('visibilitychange', this.aoTrocarAba);
  }

  static async criar(
    container: HTMLElement,
    visual: Omit<Visual, 'bloom' | 'reduzirMovimento'>,
    { forcarWebGL = false } = {}
  ): Promise<JogoJet> {
    const jogo = new JogoJet(container, { ...visual, reduzirMovimento: reduzirMovimento() });
    await jogo.montarCena(forcarWebGL);
    jogo.raf = requestAnimationFrame((t) => jogo.laco(t));
    return jogo;
  }

  private async montarCena(forcarWebGL: boolean): Promise<void> {
    try {
      this.renderer = await criarRenderer(this.canvas, forcarWebGL);
      this.qualidade = new QualidadeAdaptativa(this.renderer);
      this.cena = new CenaJet(this.renderer, this.canvas, {
        ...this.visual,
        // Bloom é o efeito mais caro; celular começa sem ele.
        bloom: !matchMedia('(pointer: coarse)').matches
      });
      await this.cena.aquecer();
    } catch (err) {
      // Sem GPU a rodada continua valendo (a simulação é independente do render),
      // só não há o que ver. Melhor avisar do que travar a Arena.
      console.warn('[Jet Launcher] Render indisponível:', err);
      this.cena = null;
    }
  }

  get temRender(): boolean {
    return this.cena !== null;
  }

  get emPartida(): boolean {
    return this.host !== null;
  }

  async jogar(opcoes: OpcoesPartida): Promise<FimDePartida> {
    if (this.host) throw new Error('Já existe uma partida em andamento');
    this.audio.iniciar();
    const host = new SimHost();
    this.host = host;
    this.ultimoTick = -1;

    try {
      await host.preparar({
        codigoJogo: CODIGO_JET,
        semente: opcoes.semente,
        loadout: opcoes.loadout,
        replayLog: opcoes.replayLog
      });
      this.hud.preparar(
        opcoes.scoreMultiplier,
        opcoes.subscriberMultiplier,
        opcoes.ticks,
        !opcoes.replayLog
      );
      this.hud.visivel(true);
      // Filme de 15–20 s: pular não muda nada, a rodada já foi liquidada no clique.
      this.hud.pular(true);
      this.canvas.focus({ preventScroll: true });

      host.comecar();
      const fim = await host.terminou();

      this.audio.vitoria();
      const q = host.quadro(performance.now());
      if (q) this.quadroParado = { ...q, anterior: q.atual, alfa: 1 };
      return fim;
    } finally {
      this.hud.pular(false);
      this.audio.motor(0, 1, false);
      this.audio.alarmeMissil(false);
      host.encerrar();
      this.host = null;
    }
  }

  sair(): void {
    this.host?.sair();
  }

  private laco(agora: number): void {
    if (this.destruido) return;
    this.raf = requestAnimationFrame((t) => this.laco(t));
    const ms = agora - this.ultimoAgora;
    this.ultimoAgora = agora;

    let quadro: Quadro = this.quadroParado;
    if (this.host) {
      quadro = this.host.quadro(agora) ?? this.quadroParado;
      const b = quadro.atual;
      if (quadro.tick !== this.ultimoTick) {
        this.ultimoTick = quadro.tick;
        this.hud.eventos(b);
        this.tocarEventos(b);
      }
      this.hud.atualizar(b, quadro.tick);
      const intensidade = Math.min(1, b[H.VELOCIDADE] / 260);
      this.audio.motor(intensidade, b[H.ESCALA_TEMPO] < 1 ? 0.6 : 1, b[H.PLANEIO] <= 0);
      this.audio.alarmeMissil(b[H.AVISO_MISSIL] > 0 && b[H.FLARES] <= 0);
    } else {
      // Ocioso: o jato "respira" na pista.
      const b = this.quadroParado.atual;
      if (this.quadroParado.tick === -1) b[H.Y] = 40 + Math.sin(agora * 0.0015) * 1.5;
    }

    if (this.cena && this.visivelNaTela && !document.hidden) {
      this.cena.atualizar(quadro, agora);
      this.cena.desenhar();
      this.qualidade?.registrar(ms);
    }
  }

  private tocarEventos(b: Float32Array): void {
    if (temEvento(b, EVENTO.ANEL)) this.audio.anel();
    if (temEvento(b, EVENTO.BATIDA)) this.audio.batida();
    if (temEvento(b, EVENTO.ESCUDO)) this.audio.escudo();
    if (temEvento(b, EVENTO.NITRO)) this.audio.nitro();
    if (temEvento(b, EVENTO.FLARES)) this.audio.flares();
    if (temEvento(b, EVENTO.ROLAGEM)) this.audio.rolagem();
    if (temEvento(b, EVENTO.ESQUIVA_PERFEITA)) this.audio.esquivaPerfeita();
    if (temEvento(b, EVENTO.QUASE_COLISAO)) this.audio.quaseColisao();
    if (temEvento(b, EVENTO.BATIDA) || temEvento(b, EVENTO.ESQUIVA_PERFEITA)) {
      if (typeof navigator.vibrate === 'function')
        navigator.vibrate(temEvento(b, EVENTO.BATIDA) ? 90 : 30);
    }
  }

  get drawCalls(): number {
    return this.cena ? this.cena.drawCalls : 0;
  }

  destruir(): void {
    this.destruido = true;
    cancelAnimationFrame(this.raf);
    this.host?.encerrar();
    this.host = null;
    this.observador.disconnect();
    window.removeEventListener('keydown', this.aoTeclar);
    document.removeEventListener('visibilitychange', this.aoTrocarAba);
    this.audio.encerrar();
    this.cena?.destruir();
    this.renderer?.dispose();
    this.hud.destruir();
    this.palco.remove();
  }
}
