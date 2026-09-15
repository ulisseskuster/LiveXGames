import * as THREE from 'three/webgpu';
import type { Quadro } from '../shell/simHost';

/**
 * Índices do buffer de render do sandbox. Espelham Sandbox::render em
 * games/sim/src/games/sandbox.rs — mudou lá, muda aqui.
 */
export const R = {
  X: 0,
  Z: 1,
  VELOCIDADE: 2,
  CASCO: 3,
  COMBUSTIVEL: 4,
  BOOST: 5,
  INVULNERAVEL: 6,
  SELECIONADO: 7,
  CARGAS: 8,
  N_BLOCOS: 11,
  BLOCOS: 12
} as const;

const MAX_BLOCOS = 256;
const CELULA_GRADE = 5;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class CenaSandbox {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400);
  private readonly jogador: THREE.Mesh;
  private readonly blocos: THREE.InstancedMesh;
  private readonly pista: THREE.Mesh;
  private readonly grade: THREE.GridHelper;
  private readonly auxiliar = new THREE.Object3D();
  private fov = 60;

  constructor(
    private readonly renderer: THREE.WebGPURenderer,
    private readonly canvas: HTMLCanvasElement
  ) {
    this.scene.background = new THREE.Color(0x05070f);
    this.scene.fog = new THREE.Fog(0x05070f, 40, 160);
    this.scene.add(new THREE.HemisphereLight(0x88ccff, 0x220a2a, 1.2));
    const sol = new THREE.DirectionalLight(0xffffff, 1.6);
    sol.position.set(4, 10, 6);
    this.scene.add(sol);

    this.jogador = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.8, 1.6),
      new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        emissive: 0x0077aa,
        emissiveIntensity: 0.8,
        metalness: 0.3,
        roughness: 0.4
      })
    );

    // Uma única draw call para todos os blocos.
    this.blocos = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1.2, 1.6),
      new THREE.MeshStandardMaterial({
        color: 0xff3d8b,
        emissive: 0x88113f,
        emissiveIntensity: 0.7
      }),
      MAX_BLOCOS
    );
    this.blocos.count = 0;
    this.blocos.frustumCulled = false;

    this.pista = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 600),
      new THREE.MeshStandardMaterial({ color: 0x0b1024, roughness: 0.9 })
    );
    this.pista.rotation.x = -Math.PI / 2;

    this.grade = new THREE.GridHelper(600, 600 / CELULA_GRADE, 0x1b3a6b, 0x10213f);
    this.grade.position.y = 0.01;

    this.scene.add(this.jogador, this.blocos, this.pista, this.grade);

    new ResizeObserver(() => this.redimensionar()).observe(canvas);
    this.redimensionar();
  }

  /**
   * Compila os pipelines antes da partida. No WebGPU a compilação acontece no
   * primeiro uso, e o primeiro uso seria no meio do jogo — um engasgo visível.
   */
  async aquecer(): Promise<void> {
    await this.renderer.compileAsync(this.scene, this.camera);
  }

  get drawCalls(): number {
    return this.renderer.info.render.drawCalls;
  }

  atualizar(q: Quadro, agora: number): void {
    const { anterior: a, atual: b, alfa } = q;
    const x = lerp(a[R.X], b[R.X], alfa);
    const z = lerp(a[R.Z], b[R.Z], alfa);

    // A simulação anda em +Z; no Three a câmera olha para -Z.
    this.jogador.position.set(x, 0.4, -z);
    const invulneravel = b[R.INVULNERAVEL] > 0;
    this.jogador.visible = !invulneravel || Math.floor(agora / 80) % 2 === 0;

    const n = Math.min(MAX_BLOCOS, b[R.N_BLOCOS]);
    for (let i = 0; i < n; i++) {
      const o = R.BLOCOS + i * 3;
      this.auxiliar.position.set(b[o], 0.6, -b[o + 1]);
      this.auxiliar.scale.set(b[o + 2] * 2, 1, 1);
      this.auxiliar.updateMatrix();
      this.blocos.setMatrixAt(i, this.auxiliar.matrix);
    }
    this.blocos.count = n;
    this.blocos.instanceMatrix.needsUpdate = true;

    // Pista e grade acompanham o jogador; a grade anda em saltos de uma célula
    // para as linhas não "deslizarem" junto com ele.
    this.pista.position.z = -z - 200;
    this.grade.position.z = -(z - (z % CELULA_GRADE)) - 250;

    const alvoFov = b[R.BOOST] > 0 ? 74 : 60;
    this.fov = lerp(this.fov, alvoFov, 0.12);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(x * 0.6, 3.6, -z + 8);
    this.camera.lookAt(x * 0.8, 0.6, -z - 12);
  }

  desenhar(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private redimensionar(): void {
    const largura = this.canvas.clientWidth;
    const altura = this.canvas.clientHeight;
    if (!largura || !altura) return;
    this.renderer.setSize(largura, altura, false);
    this.camera.aspect = largura / altura;
    this.camera.updateProjectionMatrix();
  }
}
