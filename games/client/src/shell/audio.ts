/**
 * Áudio dos jogos: Web Audio API nativa, sons sintetizados na hora.
 *
 * Sintetizar em vez de baixar arquivos: nenhum byte a mais no carregamento e o
 * motor muda de timbre continuamente com a velocidade, o que um arquivo gravado
 * não faz. Respeita o mudo global do site (window.JetSound, em sound.js).
 */

type SomDoSite = { isMuted?: () => boolean };

export class Audio {
  constructor(private readonly perfil: 'jet' | 'neon' | 'void' = 'jet') {}

  private ctx: AudioContext | null = null;
  private mestre: GainNode | null = null;
  private motorGanho: GainNode | null = null;
  private motorFiltro: BiquadFilterNode | null = null;
  private motorOsc: OscillatorNode | null = null;
  private ruido: AudioBuffer | null = null;
  private alarme: { osc: OscillatorNode; ganho: GainNode } | null = null;

  private get mudo(): boolean {
    const som = (window as unknown as { JetSound?: SomDoSite }).JetSound;
    return Boolean(som?.isMuted?.());
  }

  /** Precisa vir de um gesto do usuário: navegadores bloqueiam áudio automático. */
  iniciar(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;

    // Compressor no fim: explosão e alarme juntos não podem estourar o volume.
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.connect(ctx.destination);
    this.mestre = ctx.createGain();
    this.mestre.gain.value = 0.55;
    this.mestre.connect(compressor);

    const tamanho = ctx.sampleRate * 2;
    this.ruido = ctx.createBuffer(1, tamanho, ctx.sampleRate);
    const dados = this.ruido.getChannelData(0);
    for (let i = 0; i < tamanho; i++) dados[i] = Math.random() * 2 - 1;

    this.motorFiltro = ctx.createBiquadFilter();
    this.motorFiltro.type = 'lowpass';
    this.motorFiltro.frequency.value = 400;
    this.motorGanho = ctx.createGain();
    this.motorGanho.gain.value = 0;
    this.motorFiltro.connect(this.motorGanho).connect(this.mestre);

    const turbina = ctx.createBufferSource();
    turbina.buffer = this.ruido;
    turbina.loop = true;
    const ruidoGanho = ctx.createGain();
    ruidoGanho.gain.value = this.perfil === 'jet' ? 0.8 : this.perfil === 'neon' ? 0.12 : 0.035;
    turbina.connect(ruidoGanho).connect(this.motorFiltro);
    turbina.start();

    this.motorOsc = ctx.createOscillator();
    this.motorOsc.type = this.perfil === 'void' ? 'sine' : 'sawtooth';
    this.motorOsc.frequency.value = 60;
    const oscGanho = ctx.createGain();
    oscGanho.gain.value = this.perfil === 'neon' ? 0.35 : this.perfil === 'void' ? 0.22 : 0.08;
    this.motorOsc.connect(oscGanho).connect(this.motorFiltro);
    this.motorOsc.start();
  }

  /**
   * @param intensidade 0..1 (velocidade relativa)
   * @param escalaTempo 1 normal; menor no bullet-time abaixa o timbre inteiro
   */
  motor(intensidade: number, escalaTempo = 1, ligado = true): void {
    if (!this.ctx || !this.motorGanho || !this.motorFiltro || !this.motorOsc) return;
    const t = this.ctx.currentTime;
    this.mestre?.gain.setTargetAtTime(this.mudo ? 0 : 0.55, t, 0.03);
    const alvo = ligado && !this.mudo ? 0.12 + intensidade * 0.22 : 0;
    this.motorGanho.gain.setTargetAtTime(alvo, t, 0.08);
    this.motorFiltro.frequency.setTargetAtTime((300 + intensidade * 2600) * escalaTempo, t, 0.1);
    const base =
      this.perfil === 'void'
        ? 70 + intensidade * 30
        : this.perfil === 'neon'
          ? 40 + ((intensidade * 3.8) % 1) * 65
          : 50 + intensidade * 90;
    this.motorOsc.frequency.setTargetAtTime(base * escalaTempo, t, 0.1);
  }

  alarmeMissil(ativo: boolean): void {
    if (!this.ctx || !this.mestre) return;
    if (ativo && !this.alarme && !this.mudo) {
      const osc = this.ctx.createOscillator();
      const ganho = this.ctx.createGain();
      const lfo = this.ctx.createOscillator();
      const lfoGanho = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 1320;
      ganho.gain.value = 0;
      lfo.frequency.value = 7;
      lfoGanho.gain.value = 0.05;
      lfo.connect(lfoGanho).connect(ganho.gain);
      osc.connect(ganho).connect(this.mestre);
      osc.start();
      lfo.start();
      this.alarme = { osc, ganho };
    } else if (!ativo && this.alarme) {
      this.alarme.osc.stop();
      this.alarme = null;
    }
  }

  private tom(
    freq: number,
    fim: number,
    duracao: number,
    tipo: OscillatorType,
    volume: number
  ): void {
    if (!this.ctx || !this.mestre || this.mudo) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const ganho = this.ctx.createGain();
    osc.type = tipo;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, fim), t + duracao);
    ganho.gain.setValueAtTime(volume, t);
    ganho.gain.exponentialRampToValueAtTime(0.001, t + duracao);
    osc.connect(ganho).connect(this.mestre);
    osc.start(t);
    osc.stop(t + duracao + 0.02);
  }

  private estouro(duracao: number, volume: number, corte: number): void {
    if (!this.ctx || !this.mestre || !this.ruido || this.mudo) return;
    const t = this.ctx.currentTime;
    const fonte = this.ctx.createBufferSource();
    fonte.buffer = this.ruido;
    const filtro = this.ctx.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.frequency.setValueAtTime(corte, t);
    filtro.frequency.exponentialRampToValueAtTime(80, t + duracao);
    const ganho = this.ctx.createGain();
    ganho.gain.setValueAtTime(volume, t);
    ganho.gain.exponentialRampToValueAtTime(0.001, t + duracao);
    fonte.connect(filtro).connect(ganho).connect(this.mestre);
    fonte.start(t);
    fonte.stop(t + duracao);
  }

  anel(): void {
    this.tom(880, 1760, 0.18, 'triangle', 0.25);
    this.tom(1320, 2640, 0.22, 'sine', 0.12);
  }

  batida(): void {
    this.estouro(0.45, 0.9, 1800);
    this.tom(120, 40, 0.35, 'sine', 0.5);
  }

  escudo(): void {
    this.tom(500, 1500, 0.25, 'sawtooth', 0.18);
  }

  nitro(): void {
    this.estouro(0.7, 0.45, 5000);
    this.tom(200, 600, 0.6, 'sawtooth', 0.12);
  }

  flares(): void {
    for (let i = 0; i < 4; i++) setTimeout(() => this.tom(2400, 900, 0.08, 'square', 0.08), i * 60);
  }

  rolagem(): void {
    this.estouro(0.25, 0.25, 3000);
  }

  esquivaPerfeita(): void {
    this.tom(220, 110, 0.9, 'sine', 0.35);
    this.tom(660, 1320, 0.5, 'triangle', 0.15);
  }

  quaseColisao(): void {
    this.tom(1600, 700, 0.12, 'triangle', 0.1);
  }

  explosao(): void {
    this.estouro(1.2, 1, 1200);
  }

  vitoria(): void {
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => this.tom(f, f, 0.25, 'triangle', 0.2), i * 110)
    );
  }

  encerrar(): void {
    this.alarmeMissil(false);
    void this.ctx?.close();
    this.ctx = null;
  }
}
