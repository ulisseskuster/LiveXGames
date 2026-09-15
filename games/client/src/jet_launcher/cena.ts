import * as THREE from 'three/webgpu';
import {
  abs,
  color,
  floor,
  float,
  fract,
  normalWorld,
  normalLocal,
  cameraPosition,
  uniform,
  mix,
  smoothstep,
  pass,
  positionWorld,
  sin,
  step,
  uv
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { luz } from '../shell/cinemaScene';
import { ambiente, asa, bloco, fuselagem, malha, liberarArte } from '../shell/arte';
import type { Quadro } from '../shell/simHost';
import { EVENTO, H, ROLL_TICKS, lerEntidades, temEvento, type Entidades } from './estado';

/**
 * Cena do Jet Launcher. Só desenha: posição, colisão e regra vêm do buffer da
 * simulação. Coordenadas: X e Y iguais aos da simulação; o Z da simulação cresce
 * para a frente e no Three a câmera olha para -Z, então z_three = -z_sim.
 */

export type Visual = {
  /** Pintura Dourada: benefício de sub. */
  assinante: boolean;
  /** Visual holográfico do item lendário vip_hangar. Só visual. */
  lendario: boolean;
  reduzirMovimento: boolean;
  bloom: boolean;
};

const MAX_PREDIOS = 160;
const MAX_ANEIS = 24;
const MAX_DRONES = 64;
const MAX_MISSEIS = 16;
const MAX_DETRITOS = 64;
const RASTRO = 48;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Suavização independente de fps: a mesma sensação a 60 e a 144 Hz. */
const suavizar = (atual: number, alvo: number, rapidez: number, dt: number) =>
  lerp(atual, alvo, 1 - Math.exp(-rapidez * dt));

function materialDoJato(visual: Visual): THREE.Material {
  if (visual.assinante) {
    return new THREE.MeshPhysicalNodeMaterial({
      color: 0xffd24a,
      metalness: 1,
      roughness: 0.22,
      clearcoat: 1,
      emissive: 0x3a2800,
      emissiveIntensity: 0.6
    });
  }
  if (visual.lendario) {
    return new THREE.MeshPhysicalNodeMaterial({
      color: 0xc8f0ff,
      metalness: 0.9,
      roughness: 0.12,
      iridescence: 1,
      iridescenceIOR: 1.8,
      clearcoat: 1
    });
  }
  return new THREE.MeshStandardNodeMaterial({ color: 0x9fb3c8, metalness: 0.75, roughness: 0.32 });
}

/** ORION-07: fuselagem contínua e asas enflechadas, arte original do projeto. */
function montarJato(visual: Visual): { grupo: THREE.Group; chama: THREE.Mesh } {
  const grupo = new THREE.Group(),
    casco = materialDoJato(visual);
  const escuro = new THREE.MeshStandardNodeMaterial({
    color: 0x182938,
    metalness: 0.6,
    roughness: 0.4
  });
  const vidro = new THREE.MeshPhysicalNodeMaterial({
    color: 0x183f58,
    metalness: 0.65,
    roughness: 0.1,
    clearcoat: 1
  });
  malha(
    grupo,
    fuselagem([
      [-5.5, 0.01, 0.01, 0],
      [-4.3, 0.35, 0.28, 0],
      [-2.5, 0.7, 0.47, 0],
      [-0.6, 1.03, 0.55, 0],
      [1.8, 0.94, 0.43, 0],
      [3.8, 0.62, 0.3, 0],
      [4, 0.01, 0.01, 0]
    ]),
    casco
  );
  malha(
    grupo,
    fuselagem([
      [-3.5, 0.02, 0.01, 0.25],
      [-2.8, 0.4, 0.35, 0.45],
      [-1.4, 0.49, 0.42, 0.5],
      [-0.5, 0.15, 0.08, 0.48],
      [-0.4, 0.01, 0.01, 0.4]
    ]),
    vidro
  );
  for (const side of [-1, 1]) {
    const wing = malha(
      grupo,
      asa([
        [0.6, -1.8],
        [4.7, 2.4],
        [4.5, 3.2],
        [0.6, 1.9]
      ]),
      casco
    );
    wing.scale.x = side;
    const cauda = malha(
      grupo,
      asa([
        [0.6, 2.4],
        [2.35, 3.75],
        [2.2, 4.25],
        [0.5, 3.9]
      ]),
      casco
    );
    cauda.scale.x = side;
    const leme = malha(
      grupo,
      asa([
        [0, 0],
        [1.55, 1.4],
        [1.45, 2.1],
        [0, 1.7]
      ]),
      escuro,
      side * 0.74,
      0.3,
      1.3
    );
    leme.rotation.z = side * 1.08;
    malha(grupo, bloco(0.42, 0.52, 2.6), escuro, side * 0.94, -0.2, 0.1);
    const motor = malha(
      grupo,
      new THREE.CylinderGeometry(0.38, 0.43, 1.3, 20),
      escuro,
      side * 0.62,
      -0.12,
      3.4
    );
    motor.rotation.x = Math.PI / 2;
    malha(
      grupo,
      new THREE.TorusGeometry(0.33, 0.045, 8, 24),
      luz(0x9bdbff, 1.8),
      side * 0.62,
      -0.12,
      4.06
    );
    malha(
      grupo,
      bloco(0.5, 0.025, 0.08, 0.01),
      luz(side > 0 ? 0x91d4d8 : 0xff6554, 1.4),
      side * 4.38,
      0.1,
      2.73
    );
    malha(grupo, bloco(0.045, 0.025, 2.5, 0.01), escuro, side * 0.65, 0.52, 0.8);
  }
  const chama = malha(
    grupo,
    new THREE.ConeGeometry(0.22, 2.4, 16),
    new THREE.MeshBasicNodeMaterial({
      color: visual.assinante ? 0xffc77a : 0x68bfff,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }),
    -0.62,
    -0.12,
    5.15
  );
  chama.geometry.rotateX(Math.PI / 2);
  const segunda = new THREE.Mesh(chama.geometry, chama.material);
  segunda.position.x = 1.24;
  chama.add(segunda);
  return { grupo, chama };
}

export class CenaJet {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.5, 1600);
  private readonly pipeline: THREE.RenderPipeline | null;
  private readonly jato: THREE.Group;
  private readonly chama: THREE.Mesh;
  private readonly predios: THREE.InstancedMesh;
  private readonly horizonte: THREE.InstancedMesh;
  private readonly coroas: THREE.InstancedMesh;
  private readonly aneis: THREE.InstancedMesh;
  private readonly drones: THREE.InstancedMesh;
  private readonly marcadoresDrones: THREE.InstancedMesh;
  private readonly escudo: THREE.Mesh;
  private readonly intensidadeEscudo = uniform(0);
  private escudoAteTick = -1;
  private readonly atmosfera = uniform(0);
  private readonly misseis: THREE.InstancedMesh;
  private readonly detritos: THREE.InstancedMesh;
  private readonly estrelas: THREE.Points;
  private readonly ceu: THREE.Mesh;
  private readonly terraços: THREE.InstancedMesh;
  private readonly observer: ResizeObserver;
  private readonly chao: THREE.Mesh;
  private readonly rastro: THREE.Line;
  private readonly pontosRastro = new Float32Array(RASTRO * 3);
  private readonly aux = new THREE.Object3D();
  private readonly corAux = new THREE.Color();
  private readonly ceuBaixo = new THREE.Color(0x647c91);
  private readonly ceuAlto = new THREE.Color(0x010208);
  private entidades: Entidades | null = null;
  private tickDasEntidades = -1;
  private camPos = new THREE.Vector3(0, 45, 20);
  private fov = 68;
  private tremor = 0;
  private ultimoAgora = 0;
  private rastroPronto = false;

  constructor(
    private readonly renderer: THREE.WebGPURenderer,
    private readonly canvas: HTMLCanvasElement,
    private readonly visual: Visual
  ) {
    this.scene.background = this.ceuBaixo.clone();
    // Fecha antes dos 1000 m em que a simulação cria prédios, anéis e drones: eles
    // saem da neblina em vez de brotar na tela.
    this.scene.fog = new THREE.Fog(0x647c91, 160, 900);
    this.scene.add(new THREE.HemisphereLight(0xc2d6e6, 0x263449, 1.25));
    const sol = new THREE.DirectionalLight(0xffd5aa, 2.8);
    sol.position.set(-60, 120, 40);
    this.scene.add(sol);
    ambiente(this.scene, true);
    const sky = new THREE.MeshBasicNodeMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    });
    sky.colorNode = mix(
      mix(color(0xf1c3a2), color(0x252b4e), this.atmosfera),
      mix(color(0x416b90), color(0x01020b), this.atmosfera),
      smoothstep(-0.08, 0.65, normalLocal.y)
    );
    this.ceu = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 20), sky);
    this.ceu.renderOrder = -1;
    this.scene.add(this.ceu);
    const halo = new THREE.MeshBasicNodeMaterial({
      color: 0xffd3a4,
      fog: false,
      transparent: true,
      depthWrite: false
    });
    halo.opacityNode = float(1)
      .sub(smoothstep(0.03, 0.5, uv().sub(0.5).length()))
      .mul(float(1).sub(this.atmosfera))
      .mul(0.3);
    malha(this.ceu, new THREE.PlaneGeometry(260, 260), halo, -320, 230, -950);
    malha(
      this.ceu,
      new THREE.CircleGeometry(27, 48),
      new THREE.MeshBasicNodeMaterial({
        color: 0xffe1b5,
        fog: false,
        transparent: true,
        opacityNode: float(1).sub(this.atmosfera),
        depthWrite: false
      }),
      -320,
      230,
      -949
    );

    const jato = montarJato(visual);
    this.jato = jato.grupo;
    this.chama = jato.chama;
    this.scene.add(this.jato);
    const escudoMat = new THREE.MeshBasicNodeMaterial({
      color: 0x8ce8ff,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const contorno = float(1)
      .sub(abs(normalWorld.dot(cameraPosition.sub(positionWorld).normalize())))
      .pow(2.5);
    escudoMat.opacityNode = contorno.mul(0.55).add(0.045).mul(this.intensidadeEscudo);
    this.escudo = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), escudoMat);
    this.escudo.name = 'halo-escudo';
    this.escudo.scale.set(5.7, 2.2, 6.5);
    this.escudo.visible = false;
    this.scene.add(this.escudo);

    // Janelas acesas em shader, a partir da posição no mundo: não dependem da
    // escala de cada prédio e não custam textura nenhuma.
    const materialPredio = new THREE.MeshStandardNodeMaterial({
      color: 0x8b9ca7,
      roughness: 0.75,
      metalness: 0.12
    });
    const lateral = float(1).sub(abs(normalWorld.y));
    const coluna = floor(positionWorld.x.add(positionWorld.z).mul(0.22));
    const andar = floor(positionWorld.y.mul(0.28));
    const acesa = step(
      float(0.73),
      fract(sin(coluna.mul(12.9898).add(andar.mul(78.233))).mul(43758.5453))
    );
    const vao = step(float(0.35), fract(positionWorld.x.add(positionWorld.z).mul(0.22))).mul(
      step(float(0.45), fract(positionWorld.y.mul(0.28)))
    );
    // Vidro, montantes e concreto têm leituras diferentes à luz do amanhecer.
    const montante = step(0.88, fract(positionWorld.x.add(positionWorld.z).mul(0.22)));
    const laje = step(0.88, fract(positionWorld.y.mul(0.28)));
    materialPredio.colorNode = mix(color(0x40586c), color(0xabb4b7), montante.max(laje));
    materialPredio.emissiveNode = color(0xffd4a1).mul(vao).mul(acesa).mul(lateral).mul(0.1);
    this.predios = this.instanciado(new THREE.BoxGeometry(1, 1, 1), materialPredio, MAX_PREDIOS);
    // Cidade além do corredor de voo: cenário, sem colisões ou recompensas.
    this.horizonte = this.instanciado(new THREE.BoxGeometry(1, 1, 1), materialPredio, 96);

    this.coroas = this.instanciado(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardNodeMaterial({ color: 0x8192a0, roughness: 0.7 }),
      MAX_PREDIOS
    );
    this.terraços = this.instanciado(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardNodeMaterial({ color: 0x273949, roughness: 0.85 }),
      MAX_PREDIOS
    );
    this.aneis = this.instanciado(
      new THREE.TorusGeometry(1, 0.09, 8, 40),
      new THREE.MeshBasicNodeMaterial({ color: 0xffffff }),
      MAX_ANEIS
    );
    this.drones = this.instanciado(
      new THREE.OctahedronGeometry(3, 0),
      new THREE.MeshStandardNodeMaterial({
        color: 0x58485c,
        emissive: 0xff7651,
        emissiveIntensity: 0.5,
        metalness: 0.6,
        roughness: 0.3
      }),
      MAX_DRONES
    );
    this.marcadoresDrones = this.instanciado(
      new THREE.TorusGeometry(4.6, 0.13, 6, 28, Math.PI * 1.4),
      luz(0xff9567, 1.8),
      MAX_DRONES
    );
    const geoMissil = new THREE.ConeGeometry(0.7, 4, 10);
    geoMissil.rotateX(Math.PI / 2);
    this.misseis = this.instanciado(
      geoMissil,
      new THREE.MeshStandardNodeMaterial({
        color: 0x33080a,
        emissive: 0xff3b2f,
        emissiveIntensity: 2
      }),
      MAX_MISSEIS
    );
    this.detritos = this.instanciado(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardNodeMaterial({ color: 0x5b6475, roughness: 0.95, flatShading: true }),
      MAX_DETRITOS
    );

    this.chao = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 2400),
      new THREE.MeshStandardNodeMaterial({ color: 0x344453, roughness: 0.95 })
    );
    this.chao.rotation.x = -Math.PI / 2;
    this.scene.add(this.chao);

    const posEstrelas = new Float32Array(1500 * 3);
    for (let i = 0; i < posEstrelas.length; i += 3) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.45;
      posEstrelas[i] = Math.cos(theta) * Math.sin(phi) * 1200;
      posEstrelas[i + 1] = Math.cos(phi) * 1200;
      posEstrelas[i + 2] = Math.sin(theta) * Math.sin(phi) * 1200;
    }
    const geoEstrelas = new THREE.BufferGeometry();
    geoEstrelas.setAttribute('position', new THREE.BufferAttribute(posEstrelas, 3));
    this.estrelas = new THREE.Points(
      geoEstrelas,
      new THREE.PointsNodeMaterial({
        color: 0xffffff,
        size: 1.6,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0
      })
    );
    this.scene.add(this.estrelas);

    const geoRastro = new THREE.BufferGeometry();
    geoRastro.setAttribute('position', new THREE.BufferAttribute(this.pontosRastro, 3));
    this.rastro = new THREE.Line(
      geoRastro,
      new THREE.LineBasicNodeMaterial({
        color: visual.assinante ? 0xffd24a : visual.lendario ? 0xb88cff : 0x7fe8ff,
        transparent: true,
        opacity: 0.7
      })
    );
    this.rastro.frustumCulled = false;
    this.scene.add(this.rastro);

    if (visual.bloom) {
      const cena = pass(this.scene, this.camera);
      const saida = cena.getTextureNode('output');
      this.pipeline = new THREE.RenderPipeline(renderer, saida.add(bloom(saida, 0.2, 0.25, 1.4)));
    } else {
      this.pipeline = null;
    }

    this.observer = new ResizeObserver(() => this.redimensionar());
    this.observer.observe(canvas);
    this.redimensionar();
  }

  private instanciado(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    max: number
  ): THREE.InstancedMesh {
    const malha = new THREE.InstancedMesh(geo, mat, max);
    malha.count = 0;
    malha.frustumCulled = false;
    this.scene.add(malha);
    return malha;
  }

  /**
   * Compila os pipelines antes da largada. No WebGPU a compilação acontece no
   * primeiro uso — no meio da primeira explosão, como um engasgo.
   */
  async aquecer(): Promise<void> {
    await this.renderer.compileAsync(this.scene, this.camera);
  }

  get drawCalls(): number {
    return this.renderer.info.render.drawCalls;
  }

  /** Posiciona tudo para o quadro de tela atual. Devolve os eventos que chegaram. */
  atualizar(q: Quadro, agora: number): void {
    const dt = this.ultimoAgora ? Math.min(0.1, (agora - this.ultimoAgora) / 1000) : 1 / 60;
    this.ultimoAgora = agora;
    const { anterior: a, atual: b, alfa } = q;

    if (q.tick !== this.tickDasEntidades) {
      if (q.tick < this.tickDasEntidades) this.escudoAteTick = -1;
      this.tickDasEntidades = q.tick;
      this.entidades = lerEntidades(b);
      if (temEvento(b, EVENTO.BATIDA)) this.tremor = this.visual.reduzirMovimento ? 0 : 1;
      if (temEvento(b, EVENTO.ESCUDO)) this.tremor = this.visual.reduzirMovimento ? 0 : 0.4;
      // Considera também o quadro anterior para apresentação a 30 fps. Uma
      // invulnerabilidade comum não confirma consumo/absorção de escudo.
      if ((temEvento(b, EVENTO.ESCUDO) || temEvento(a, EVENTO.ESCUDO)) && b[H.INVULNERAVEL] > 0)
        this.escudoAteTick = q.tick + b[H.INVULNERAVEL];
      if (temEvento(b, EVENTO.BATIDA)) this.escudoAteTick = -1;
    }
    this.escudo.visible = q.tick >= 0 && q.tick < this.escudoAteTick && b[H.INVULNERAVEL] > 0;
    this.intensidadeEscudo.value = this.escudo.visible ? Math.min(1, b[H.INVULNERAVEL] / 12) : 0;

    const x = lerp(a[H.X], b[H.X], alfa);
    const y = lerp(a[H.Y], b[H.Y], alfa);
    const z = lerp(a[H.Z], b[H.Z], alfa);

    this.posicionarJato(b, x, y, z, agora);
    this.posicionarEntidades(b, z, agora);
    this.posicionarCeu(b, x, z, dt);
    this.posicionarCamera(b, x, y, z, dt, agora);
  }

  private posicionarJato(b: Float32Array, x: number, y: number, z: number, agora: number): void {
    this.jato.position.set(x, y, -z);
    const giro =
      b[H.ROLAGEM] > 0
        ? (1 - b[H.ROLAGEM] / ROLL_TICKS) * Math.PI * 2 * Math.sign(b[H.VX] || 1)
        : 0;
    this.jato.rotation.set(b[H.VY] * 0.012, 0, -b[H.VX] * 0.018 - giro);
    this.escudo.position.copy(this.jato.position);
    this.escudo.quaternion.copy(this.jato.quaternion);
    // Piscando enquanto invulnerável depois de uma batida.
    this.jato.visible =
      this.escudo.visible ||
      this.visual.reduzirMovimento ||
      b[H.INVULNERAVEL] <= 0 ||
      b[H.ROLAGEM] > 0 ||
      Math.floor(agora / 70) % 2 === 0;

    const empuxo = b[H.PLANEIO] > 0 ? 0.2 : b[H.BOOST] > 0 ? 2.2 : b[H.BOOST_ANEL] > 0 ? 1.5 : 1;
    this.chama.scale.set(
      1,
      1,
      empuxo * (this.visual.reduzirMovimento ? 1 : 0.92 + Math.sin(agora * 0.025) * 0.08)
    );

    // Rastro: guarda as últimas posições do jato.
    const p = this.pontosRastro;
    if (!this.rastroPronto) {
      for (let i = 0; i < RASTRO; i++) p.set([x, y, -z + 4], i * 3);
      this.rastroPronto = true;
    }
    p.copyWithin(3, 0, (RASTRO - 1) * 3);
    p.set([x, y, -z + 4.5], 0);
    (this.rastro.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  private posicionarEntidades(b: Float32Array, z: number, agora: number): void {
    const e = this.entidades;
    if (!e) return;
    const aux = this.aux;

    const nPredios = Math.min(MAX_PREDIOS, e.predios.length);
    for (let i = 0; i < nPredios; i++) {
      const p = e.predios[i];
      aux.position.set(p.x, p.h / 2, -p.z);
      aux.rotation.set(0, 0, 0);
      aux.scale.set(p.hw * 2, p.h, p.hd * 2);
      aux.updateMatrix();
      this.predios.setMatrixAt(i, aux.matrix);
      aux.position.y = p.h + 0.2;
      aux.scale.set(p.hw * 2.02, 0.35, p.hd * 2.02);
      aux.updateMatrix();
      this.coroas.setMatrixAt(i, aux.matrix);
      aux.position.y = p.h + 2;
      aux.scale.set(p.hw * 0.9, 4, p.hd * 0.9);
      aux.updateMatrix();
      this.terraços.setMatrixAt(i, aux.matrix);
    }
    this.fechar(this.predios, nPredios);
    this.fechar(this.coroas, nPredios);
    this.fechar(this.terraços, nPredios);

    const nAneis = Math.min(MAX_ANEIS, e.aneis.length);
    const pulso = 1 + Math.sin(agora * 0.008) * 0.06;
    const boost = b[H.BOOST] > 0;
    for (let i = 0; i < nAneis; i++) {
      const r = e.aneis[i];
      aux.position.set(r.x, r.y, -r.z);
      aux.rotation.set(0, 0, agora * 0.002);
      const escala = r.r * (r.passou ? 0.6 : pulso);
      aux.scale.set(escala, escala, escala);
      aux.updateMatrix();
      this.aneis.setMatrixAt(i, aux.matrix);
      this.corAux.set(r.passou ? 0x2a3550 : boost ? 0xffd24a : 0x3ff4ff);
      this.aneis.setColorAt(i, this.corAux);
    }
    this.fechar(this.aneis, nAneis, true);

    const nDrones = Math.min(MAX_DRONES, e.drones.length);
    const tempoDrone = b[H.TEMPO_MUNDO];
    const alerta = this.visual.reduzirMovimento ? 1 : 0.9 + Math.sin(tempoDrone * 2.5) * 0.1;
    (this.marcadoresDrones.material as THREE.MeshBasicNodeMaterial).color
      .setHex(0xff9567)
      .multiplyScalar(1.8 * alerta);
    for (let i = 0; i < nDrones; i++) {
      const d = e.drones[i];
      aux.position.set(d.x, d.y, -d.z);
      aux.rotation.set(0.25, this.visual.reduzirMovimento ? i : tempoDrone * 0.6 + i, 0);
      aux.scale.set(1, 1, 1);
      aux.updateMatrix();
      this.drones.setMatrixAt(i, aux.matrix);
      aux.rotation.set(0, 0, -0.65);
      aux.scale.setScalar(alerta);
      aux.updateMatrix();
      this.marcadoresDrones.setMatrixAt(i, aux.matrix);
    }
    this.fechar(this.drones, nDrones);
    this.fechar(this.marcadoresDrones, nDrones);

    let nMisseis = 0;
    for (const m of e.misseis) {
      // Míssil ainda travando fica fora da vista (o HUD mostra o aviso).
      if (m.travando || nMisseis >= MAX_MISSEIS || m.z - z > 900) continue;
      aux.position.set(m.x, m.y, -m.z);
      aux.rotation.set(0, 0, agora * 0.02);
      aux.scale.set(1, 1, 1);
      aux.updateMatrix();
      this.misseis.setMatrixAt(nMisseis++, aux.matrix);
    }
    this.fechar(this.misseis, nMisseis);

    const nDetritos = Math.min(MAX_DETRITOS, e.detritos.length);
    for (let i = 0; i < nDetritos; i++) {
      const d = e.detritos[i];
      aux.position.set(d.x, d.y, -d.z);
      aux.rotation.set(agora * 0.0006 * (i + 1), agora * 0.0009, 0);
      aux.scale.set(d.r, d.r, d.r);
      aux.updateMatrix();
      this.detritos.setMatrixAt(i, aux.matrix);
    }
    this.fechar(this.detritos, nDetritos);
  }

  private fechar(malha: THREE.InstancedMesh, n: number, cores = false): void {
    malha.count = n;
    malha.instanceMatrix.needsUpdate = true;
    if (cores && malha.instanceColor) malha.instanceColor.needsUpdate = true;
  }

  private posicionarCeu(b: Float32Array, x: number, z: number, dt: number): void {
    // Da megalópole à borda do espaço: o céu escurece com a altitude e as estrelas acendem.
    // A rodada curta não chega aos 20 km do roteiro original. A fase já emitida
    // também conduz o clima visual, com transição contínua independente de fps.
    const altitude = THREE.MathUtils.smoothstep(b[H.ALTITUDE], 50, 260);
    const alvo = Math.max(altitude, b[H.FASE] >= 3 ? 0.95 : b[H.FASE] >= 2 ? 0.25 : 0);
    this.atmosfera.value = suavizar(this.atmosfera.value, alvo, 1.3, dt);
    const subida = this.atmosfera.value;
    const fundo = this.scene.background as THREE.Color;
    fundo.copy(this.ceuBaixo).lerp(this.ceuAlto, subida);
    const neblina = this.scene.fog as THREE.Fog;
    neblina.color.copy(fundo);
    if (b[H.BULLET_TIME] > 0) neblina.color.lerp(new THREE.Color(0x1a3a66), 0.5);

    const materialEstrelas = this.estrelas.material as THREE.PointsNodeMaterial;
    materialEstrelas.opacity = Math.min(1, subida * 1.6);
    this.estrelas.position.set(x, 0, -z);

    this.chao.position.set(0, 0, -z - 900);
    this.ceu.position.set(x, b[H.Y], -z);
    const chaoVisivel = b[H.FASE] < 3 || b[H.ALTITUDE] < 8200;
    this.chao.visible = chaoVisivel;
    this.terraços.visible = chaoVisivel;
    this.horizonte.visible = chaoVisivel;
    // A fileira sai da posição no mundo. Com o índice relativo ao jato, todos os
    // prédios trocavam de altura e de lugar a cada 32 m voados.
    const base = Math.floor(z / 32);
    for (let i = 0; i < 96; i++) {
      const linha = base + Math.floor(i / 2);
      const altura = 30 + ((linha * 37) % 140);
      this.aux.position.set(
        (i % 2 ? -1 : 1) * (85 + (linha % 3) * 55),
        altura / 2,
        -linha * 32 + 64
      );
      this.aux.rotation.set(0, 0, 0);
      this.aux.scale.set(20 + (linha % 4) * 5, altura, 24);
      this.aux.updateMatrix();
      this.horizonte.setMatrixAt(i, this.aux.matrix);
    }
    this.fechar(this.horizonte, 96);
  }

  private posicionarCamera(
    b: Float32Array,
    x: number,
    y: number,
    z: number,
    dt: number,
    agora: number
  ): void {
    const retrato = this.camera.aspect < 1;
    const alvo = new THREE.Vector3(
      x - b[H.VX] * (retrato ? 0.02 : 0.06),
      y + 5,
      -z + (retrato ? 29 : 19)
    );
    this.camPos.x = suavizar(this.camPos.x, alvo.x, 6, dt);
    this.camPos.y = suavizar(this.camPos.y, alvo.y, 5, dt);
    // Profundidade presa ao jato: com mola no eixo da velocidade a câmera ficaria
    // para trás em 200 m/s e o jato encolheria na tela a cada boost.
    this.camPos.z = alvo.z;

    const velocidadeExtra = this.visual.reduzirMovimento
      ? 0
      : b[H.BOOST] > 0
        ? 8
        : b[H.BOOST_ANEL] > 0
          ? 4
          : 0;
    this.fov = suavizar(this.fov, 68 + velocidadeExtra, 4, dt);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();

    this.tremor = Math.max(0, this.tremor - dt * 2.5);
    const t = this.tremor * this.tremor * 1.2;
    this.camera.position.set(
      this.camPos.x + Math.sin(agora * 0.09) * t,
      this.camPos.y + Math.cos(agora * 0.11) * t,
      this.camPos.z
    );
    this.camera.lookAt(x, y + 1, -z - (retrato ? 15 : 45));
  }

  desenhar(): void {
    if (this.pipeline) this.pipeline.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private redimensionar(): void {
    const largura = this.canvas.clientWidth;
    const altura = this.canvas.clientHeight;
    if (!largura || !altura) return;
    this.renderer.setSize(largura, altura, false);
    this.camera.aspect = largura / altura;
    this.camera.updateProjectionMatrix();
  }

  destruir(): void {
    this.observer.disconnect();
    this.pipeline?.dispose();
    liberarArte(this.scene);
  }
}
