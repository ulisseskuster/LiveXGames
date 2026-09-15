import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { liberarArte } from './arte';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export type VisualCinema = {
  assinante: boolean;
  lendario: boolean;
  reduzirMovimento: boolean;
  bloom: boolean;
};
export const ler = (a: number, b: number, t: number) => a + (b - a) * t;
export const suave = (a: number, b: number, dt: number) => ler(a, b, 1 - Math.exp(-4 * dt));

/**
 * Repete um bloco de vértices `copias` vezes, deslocado de `periodo` num eixo.
 * Mover o objeto por `valor % periodo` fica contínuo: na virada cada cópia ocupa o
 * lugar exato da vizinha. Espalhar os pontos além do período fazia o padrão inteiro
 * saltar a cada volta.
 */
export function ladrilhar(base: number[], eixo: 0 | 1 | 2, periodo: number, copias: number) {
  const saida: number[] = [];
  for (let k = 0; k < copias; k++)
    base.forEach((v, i) => saida.push(i % 3 === eixo ? v + k * periodo : v));
  return saida;
}

export function metal(cor: number, visual?: VisualCinema) {
  return new THREE.MeshPhysicalNodeMaterial({
    color: visual?.assinante ? 0xffcb68 : cor,
    metalness: 0.4,
    roughness: 0.46,
    clearcoat: 0.3,
    iridescence: visual?.lendario ? 1 : 0
  });
}
export const luz = (cor: number, intensidade = 2) =>
  new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(cor).multiplyScalar(intensidade) });

export function peca(
  g: THREE.Group,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  pos: number[],
  escala = [1, 1, 1]
) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(pos[0], pos[1], pos[2]);
  m.scale.set(escala[0], escala[1], escala[2]);
  g.add(m);
  return m;
}

/** Carroceria com duas seções: silhueta afunilada em vez de caixas empilhadas. */
export function casco(largura: number, comprimento: number, altura: number, frente = 0.72) {
  const w = largura / 2,
    z = comprimento / 2;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        -w,
        0,
        z,
        w,
        0,
        z,
        w * frente,
        0,
        -z,
        -w * frente,
        0,
        -z,
        -w * 0.85,
        altura,
        z * 0.8,
        w * 0.85,
        altura,
        z * 0.8,
        w * frente * 0.85,
        altura * 0.6,
        -z,
        -w * frente * 0.85,
        altura * 0.6,
        -z
      ],
      3
    )
  );
  geo.setIndex([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0,
    4, 3, 4, 7
  ]);
  geo.computeVertexNormals();
  return geo;
}

export class CinemaScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.2, 2200);
  protected readonly aux = new THREE.Object3D();
  private readonly observer: ResizeObserver;
  private readonly pipeline: THREE.RenderPipeline | null;
  protected ultimo = 0;
  constructor(
    protected renderer: THREE.WebGPURenderer,
    protected canvas: HTMLCanvasElement,
    protected visual: VisualCinema
  ) {
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    if (visual.bloom) {
      const p = pass(this.scene, this.camera);
      const output = p.getTextureNode('output');
      this.pipeline = new THREE.RenderPipeline(renderer);
      this.pipeline.outputNode = output.add(bloom(output, 0.18, 0.2, 1.7));
    } else this.pipeline = null;
  }
  protected dt(now: number) {
    const dt = this.ultimo ? Math.min(0.05, (now - this.ultimo) / 1000) : 1 / 60;
    this.ultimo = now;
    return dt;
  }
  protected instances(geo: THREE.BufferGeometry, mat: THREE.Material, n: number) {
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }
  protected instance(
    mesh: THREE.InstancedMesh,
    i: number,
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = sx,
    sz = sx,
    ry = 0
  ) {
    this.aux.position.set(x, y, z);
    this.aux.scale.set(sx, sy, sz);
    this.aux.rotation.set(0, ry, 0);
    this.aux.updateMatrix();
    mesh.setMatrixAt(i, this.aux.matrix);
  }
  async aquecer() {
    await this.renderer.compileAsync(this.scene, this.camera);
  }
  desenhar() {
    if (this.pipeline) this.pipeline.render();
    else this.renderer.render(this.scene, this.camera);
  }
  get drawCalls() {
    return this.renderer.info.render.drawCalls;
  }
  private resize() {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  destruir() {
    this.observer.disconnect();
    liberarArte(this.scene);
    this.pipeline?.dispose();
    this.scene.clear();
  }
}
