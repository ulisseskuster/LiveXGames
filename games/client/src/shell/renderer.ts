import * as THREE from 'three/webgpu';

/**
 * WebGPU quando o navegador tem, WebGL2 quando não tem — com o mesmo código de
 * cena e shaders (TSL compila para os dois).
 *
 * `forcarWebGL` existe para testes e aparelhos em que o WebGPU anuncia suporte e
 * falha ao criar o adaptador.
 */
export async function criarRenderer(
  canvas: HTMLCanvasElement,
  forcarWebGL = false
): Promise<THREE.WebGPURenderer> {
  const criar = (forceWebGL: boolean) =>
    new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL });

  let renderer = criar(forcarWebGL);
  try {
    await renderer.init();
  } catch (err) {
    if (forcarWebGL) throw err;
    renderer.dispose();
    renderer = criar(true);
    await renderer.init();
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  return renderer;
}

export function nomeDoBackend(renderer: THREE.WebGPURenderer): string {
  const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean };
  return backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
}

/**
 * Resolução dinâmica: mede o tempo de quadro e ajusta o pixel ratio.
 *
 * Mexer na resolução, e não em sombras ou efeitos, porque é a alavanca que mais
 * rende no celular sem mudar o que o jogador enxerga de gameplay.
 */
export class QualidadeAdaptativa {
  private amostras: number[] = [];
  private escala = 1;
  private readonly maximo: number;

  constructor(private readonly renderer: THREE.WebGPURenderer) {
    this.maximo = Math.min(2, window.devicePixelRatio || 1);
    renderer.setPixelRatio(this.maximo);
  }

  get escalaAtual(): number {
    return this.escala;
  }

  registrar(msDoQuadro: number): void {
    this.amostras.push(msDoQuadro);
    if (this.amostras.length < 90) return;
    const media = this.amostras.reduce((s, v) => s + v, 0) / this.amostras.length;
    this.amostras = [];
    // 20 ms ≈ abaixo de 50 fps; 12 ms ≈ folga acima de 80 fps.
    if (media > 20 && this.escala > 0.6) this.escala = Math.round((this.escala - 0.1) * 10) / 10;
    else if (media < 12 && this.escala < 1) this.escala = Math.round((this.escala + 0.1) * 10) / 10;
    else return;
    this.renderer.setPixelRatio(this.maximo * this.escala);
  }
}
