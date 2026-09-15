/** Painel de diagnóstico, só com ?debug=1. */
export class PainelDebug {
  private readonly el: HTMLPreElement;
  private quadros = 0;
  private inicioJanela = performance.now();
  private fps = 0;

  constructor(pai: HTMLElement) {
    this.el = document.createElement('pre');
    this.el.className = 'painel-debug';
    pai.append(this.el);
  }

  quadro(dados: Record<string, string | number>): void {
    this.quadros++;
    const agora = performance.now();
    if (agora - this.inicioJanela < 500) return;
    this.fps = (this.quadros * 1000) / (agora - this.inicioJanela);
    this.quadros = 0;
    this.inicioJanela = agora;
    this.el.textContent = Object.entries({ fps: this.fps.toFixed(0), ...dados })
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
  }
}
