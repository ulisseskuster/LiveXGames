import * as THREE from 'three/webgpu';
import {
  color,
  mix,
  normalWorld,
  positionLocal,
  positionWorld,
  cameraPosition,
  sin,
  smoothstep,
  float,
  abs,
  uniform,
  uv
} from 'three/tsl';
import { ambiente, bloco, fuselagem, malha, pintura, superficiePlaneta } from '../shell/arte';
import type { Quadro } from '../shell/simHost';
import {
  CinemaScene,
  ladrilhar,
  ler,
  luz,
  metal,
  peca,
  suave,
  type VisualCinema
} from '../shell/cinemaScene';
import { V, lerEspaco } from './estado';
export type Visual = VisualCinema;

export class CenaVoid extends CinemaScene {
  private readonly magneticos: THREE.Group[] = [];
  private readonly nave = new THREE.Group();
  private readonly bob = new THREE.Group();
  private readonly motores: THREE.Mesh[] = [];
  private readonly asteroides: THREE.InstancedMesh;
  private readonly planetas: THREE.InstancedMesh;
  private readonly poeira: THREE.Points;
  private readonly mundo = new THREE.Group();
  private readonly gigante = new THREE.Group();
  private readonly singularidade = new THREE.Group();
  private readonly aneis: THREE.Mesh[] = [];
  private readonly tempoDisco = uniform(0);
  private readonly intensidadeCampo = uniform(0);
  private readonly luzCampo = new THREE.DirectionalLight(0x78a2db, 1.4);
  private readonly cabo: THREE.Line;
  private readonly pontosCabo = new Float32Array(40 * 3);
  private readonly rastros: THREE.LineSegments;
  private cameraX = 8;
  private cameraY = 6;
  constructor(renderer: THREE.WebGPURenderer, canvas: HTMLCanvasElement, visual: Visual) {
    super(renderer, canvas, visual);
    this.scene.background = new THREE.Color(0x020611);
    this.scene.add(new THREE.HemisphereLight(0x819cbb, 0x080d1b, 0.7));
    const estrela = new THREE.DirectionalLight(0xffdbb4, 2.5);
    estrela.position.set(-150, 100, 250);
    this.scene.add(estrela);
    const lateral = this.luzCampo;
    lateral.position.set(60, 0, 70);
    this.scene.add(lateral);
    ambiente(this.scene);
    const branco = pintura(0xc0c7c5, visual.assinante),
      escuro = metal(0x142436),
      cobre = pintura(0x9f6944);
    branco.iridescence = visual.lendario ? 0.65 : 0;
    // ZARA / ARK-03: explorador modular; casco curto e propulsores externos.
    malha(
      this.nave,
      fuselagem([
        [-4.1, 0.05, 0.05, 0],
        [-3.4, 0.78, 0.48, 0],
        [-1.6, 1.35, 0.8, 0],
        [1.8, 1.3, 0.85, 0],
        [3.1, 0.85, 0.5, 0],
        [3.2, 0.01, 0.01, 0]
      ]),
      branco
    );
    malha(
      this.nave,
      fuselagem([
        [-3.5, 0.05, 0.04, 0.4],
        [-2.7, 0.55, 0.22, 0.68],
        [-1.6, 0.7, 0.28, 0.76],
        [-0.8, 0.4, 0.12, 0.7],
        [-0.7, 0.01, 0.01, 0.65]
      ]),
      pintura(0x143f53)
    );
    for (const side of [-1, 1]) {
      malha(this.nave, bloco(2.4, 0.35, 1.1), escuro, side * 2, 0, 0.5);
      malha(this.nave, bloco(1.1, 0.75, 3.8, 0.25), branco, side * 2.8, 0, 1.1);
      for (const z of [-0.25, 0.5, 1.25]) {
        const brace = malha(
          this.nave,
          new THREE.TorusGeometry(0.63, 0.055, 8, 24),
          cobre,
          side * 2.8,
          0,
          z
        );
        brace.scale.y = 0.75;
      }
      malha(this.nave, new THREE.TorusGeometry(0.41, 0.09, 10, 24), escuro, side * 2.8, 0, 3.02);
      malha(this.nave, new THREE.CircleGeometry(0.33, 24), luz(0x9bcfff, 2), side * 2.8, 0, 3.1);
      const chama = malha(
        this.nave,
        new THREE.ConeGeometry(0.25, 2.8, 16),
        new THREE.MeshBasicNodeMaterial({
          color: visual.assinante ? 0xffcd89 : 0x75b5e8,
          transparent: true,
          opacity: 0.65,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        }),
        side * 2.8,
        0,
        4.3
      );
      chama.rotation.x = Math.PI / 2;
      this.motores.push(chama);
      malha(this.nave, bloco(0.045, 0.05, 2, 0.01), luz(0x8bcaea, 1.4), side * 3.35, 0, 1);
      malha(this.nave, bloco(0.85, 0.55, 1.8), cobre, side * 1.3, -0.5, 0.7);
    }
    for (let i = 0; i < 4; i++)
      malha(this.nave, bloco(1.4, 0.07, 0.16, 0.02), escuro, 0, 0.85, 0.1 + i * 0.4);
    const giro = new THREE.Group();
    giro.position.z = 1.1;
    for (let i = 0; i < 4; i++) {
      const arco = malha(
        giro,
        new THREE.TorusGeometry(3.85, 0.035, 6, 32, Math.PI * 0.38),
        luz(visual.assinante ? 0xecc186 : 0x7999b5, 1.15)
      );
      arco.rotation.z = (i * Math.PI) / 2;
    }
    giro.rotation.y = 0.15;
    this.magneticos.push(giro);
    this.nave.add(giro);
    malha(this.bob, new THREE.SphereGeometry(0.44, 20, 14), branco);
    malha(this.bob, bloco(0.55, 0.24, 0.18, 0.08), escuro, 0, 0, 0.35);
    malha(this.bob, new THREE.CircleGeometry(0.085, 16), luz(0x8df3e2, 1.5), 0, 0, 0.45);
    malha(this.bob, new THREE.TorusGeometry(0.5, 0.025, 6, 24), cobre);
    this.nave.add(this.bob);
    this.scene.add(this.nave);
    const rocha = new THREE.MeshStandardNodeMaterial({
      color: 0x555765,
      roughness: 0.95,
      flatShading: true
    });
    const geoRocha = new THREE.IcosahedronGeometry(1, 1);
    const v = geoRocha.attributes.position;
    for (let i = 0; i < v.count; i++) {
      const s = 1 + Math.sin(v.getX(i) * 12 + v.getY(i) * 7 + v.getZ(i) * 9) * 0.17;
      v.setXYZ(i, v.getX(i) * s, v.getY(i) * s, v.getZ(i) * s);
    }
    geoRocha.computeVertexNormals();
    this.asteroides = this.instances(geoRocha, rocha, 100);
    const planetaMat = new THREE.MeshStandardNodeMaterial({ color: 0x658690, roughness: 0.92 });
    planetaMat.map = superficiePlaneta(false);
    planetaMat.color.setHex(0xffffff);
    this.planetas = this.instances(new THREE.SphereGeometry(1, 28, 20), planetaMat, 32);
    const gas = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
    gas.map = superficiePlaneta(true);
    peca(this.gigante, new THREE.SphereGeometry(125, 64, 48), gas, [0, 0, 0]);
    const atmosfera = new THREE.MeshBasicNodeMaterial({
      color: 0x7db7e1,
      transparent: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    atmosfera.opacityNode = float(1)
      .sub(abs(normalWorld.dot(cameraPosition.sub(positionWorld).normalize())))
      .pow(3)
      .mul(0.6);
    peca(this.gigante, new THREE.SphereGeometry(129, 48, 32), atmosfera, [0, 0, 0]);
    const anelMat = new THREE.MeshBasicNodeMaterial({
      color: 0x9a9fbc,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.32,
      depthWrite: false
    });
    for (let i = 0; i < 2; i++) {
      const anel = peca(
        this.gigante,
        new THREE.RingGeometry(148 + i * 22, 165 + i * 22, 96),
        anelMat,
        [0, 0, 0]
      );
      anel.rotation.set(1.05, 0.15, -0.4);
    }
    this.gigante.position.set(-255, 180, -650);
    this.mundo.add(this.gigante);
    peca(
      this.singularidade,
      new THREE.SphereGeometry(34, 48, 32),
      new THREE.MeshBasicNodeMaterial({ color: 0x000106 }),
      [0, 0, 0]
    );
    const discoMat = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    // Distorção local do disco em TSL: o mesmo material compila em WebGPU/WebGL2.
    // Sem captura de tela ou passe extra de pós-processamento.
    const ondulacao = sin(uv().x.mul(26).add(this.tempoDisco))
      .mul(sin(uv().y.mul(19).sub(this.tempoDisco.mul(0.7))))
      .mul(visual.reduzirMovimento ? 0 : 0.008);
    const raio = uv().sub(0.5).length().add(ondulacao);
    const faixa = sin(raio.mul(240)).mul(0.18).add(0.75);
    discoMat.colorNode = mix(
      color(0xc87540),
      color(0xffe4b3),
      float(1).sub(smoothstep(0.2, 0.48, raio))
    )
      .mul(faixa)
      .mul(float(1).add(this.intensidadeCampo.mul(0.2)));
    discoMat.opacityNode = smoothstep(0.19, 0.24, raio).mul(
      float(1).sub(smoothstep(0.31, 0.5, raio))
    );
    const disco = peca(this.singularidade, new THREE.PlaneGeometry(170, 170), discoMat, [0, 0, 0]);
    disco.rotation.set(1.24, 0.08, -0.3);
    this.aneis.push(disco);
    const arcoMat = new THREE.MeshBasicNodeMaterial({
      color: 0xffd7a2,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    for (let i = 0; i < 3; i++) {
      const arco = peca(
        this.singularidade,
        new THREE.TorusGeometry(43 + i * 9, 0.25, 6, 64, Math.PI * 1.45),
        arcoMat,
        [0, 0, 0]
      );
      arco.rotation.set(1.24, 0.08, i * 2.1);
      this.aneis.push(arco);
    }
    const sombra = new THREE.MeshBasicNodeMaterial({
      color: 0x000106,
      transparent: true,
      depthWrite: false
    });
    const raioSombra = uv().sub(0.5).length();
    sombra.opacityNode = smoothstep(0.08, 0.2, raioSombra)
      .mul(float(1).sub(smoothstep(0.2, 0.5, raioSombra)))
      .mul(float(0.12).add(this.intensidadeCampo.mul(0.2)));
    peca(this.singularidade, new THREE.PlaneGeometry(280, 280), sombra, [0, 0, -8]);
    peca(
      this.singularidade,
      new THREE.TorusGeometry(35, 0.7, 8, 96),
      luz(0xffd89a, 1.7),
      [0, 0, 0]
    );
    this.singularidade.position.set(150, 65, -560);
    this.mundo.add(this.singularidade);
    const nebula = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
    const nuvem = sin(positionLocal.x.mul(0.005).add(sin(positionLocal.y.mul(0.007)).mul(2)))
      .mul(sin(positionLocal.y.mul(0.004).add(positionLocal.z.mul(0.003))))
      .mul(0.5)
      .add(0.5);
    nebula.colorNode = mix(color(0x040617), color(0x162038), smoothstep(0.2, 0.85, nuvem)).mul(
      float(1).sub(this.intensidadeCampo.mul(0.25))
    );
    this.mundo.add(new THREE.Mesh(new THREE.SphereGeometry(1500, 40, 24), nebula));
    const estrelas: number[] = [],
      cores: number[] = [];
    for (let i = 0; i < 1100; i++) {
      const az = i * 2.399963,
        y = 1 - (2 * (i + 0.5)) / 1100,
        r = Math.sqrt(1 - y * y);
      estrelas.push(Math.cos(az) * r * 1250, y * 1250, Math.sin(az) * r * 1250);
      cores.push(i % 5 ? 0.6 : 1, 0.75, i % 5 ? 1 : 0.65);
    }
    const estrelasGeo = new THREE.BufferGeometry();
    estrelasGeo.setAttribute('position', new THREE.Float32BufferAttribute(estrelas, 3));
    estrelasGeo.setAttribute('color', new THREE.Float32BufferAttribute(cores, 3));
    this.mundo.add(
      new THREE.Points(
        estrelasGeo,
        new THREE.PointsNodeMaterial({ size: 1.35, sizeAttenuation: false, vertexColors: true })
      )
    );
    this.scene.add(this.mundo);
    // Blocos do tamanho do período do deslocamento (ver atualizar): a volta de
    // z % período emenda sem o campo inteiro saltar.
    const particulas: number[] = [],
      riscos: number[] = [];
    for (let i = 0; i < 200; i++) {
      const x = ((i * 13.71) % 280) - 140,
        y = ((i * 19.13) % 160) - 80;
      particulas.push(x, y, -((i * 7.91) % 160));
      if (i < 25) {
        const z = -((i * 7.91) % 140);
        riscos.push(x, y, z, x, y, z + 5);
      }
    }
    const poGeo = new THREE.BufferGeometry();
    poGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(ladrilhar(particulas, 2, -160, 4), 3)
    );
    this.poeira = new THREE.Points(
      poGeo,
      new THREE.PointsNodeMaterial({ size: 0.18, color: 0x91acc8 })
    );
    this.scene.add(this.poeira);
    const riscoGeo = new THREE.BufferGeometry();
    riscoGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(ladrilhar(riscos, 2, -140, 4), 3)
    );
    this.rastros = new THREE.LineSegments(
      riscoGeo,
      new THREE.LineBasicNodeMaterial({ color: 0x79b7e8, transparent: true, opacity: 0.25 })
    );
    this.scene.add(this.rastros);
    const caboGeo = new THREE.BufferGeometry();
    caboGeo.setAttribute('position', new THREE.BufferAttribute(this.pontosCabo, 3));
    this.cabo = new THREE.Line(caboGeo, new THREE.LineBasicNodeMaterial({ color: 0x8feeff }));
    this.cabo.frustumCulled = false;
    this.scene.add(this.cabo);
  }
  atualizar(q: Quadro, now: number) {
    const b = q.atual,
      a = q.anterior,
      dt = this.dt(now);
    const x = ler(a[V.X], b[V.X], q.alfa),
      y = ler(a[V.Y], b[V.Y], q.alfa),
      z = ler(a[V.Z], b[V.Z], q.alfa);
    const tempo = Math.max(0, q.tick / 60),
      sx = x * 0.3,
      sy = (y - 18) * 0.2;
    this.nave.position.set(sx, sy, 0);
    this.bob.position.set(
      1.85,
      1.55 + (this.visual.reduzirMovimento ? 0 : Math.sin(tempo * 1.5) * 0.12),
      -1.1
    );
    this.magneticos.forEach((g, i) => {
      g.rotation.z = this.visual.reduzirMovimento ? 0 : tempo * (i ? -0.45 : 0.45);
      g.scale.setScalar(1 + Math.min(0.15, b[V.ESTILINGUE] * 0.001));
    });
    this.nave.rotation.z = suave(this.nave.rotation.z, -b[V.VX] * 0.015, dt);
    this.nave.rotation.x = suave(this.nave.rotation.x, b[V.VY] * 0.008, dt);
    this.nave.rotation.y = suave(this.nave.rotation.y, -b[V.VX] * 0.006, dt);
    this.motores.forEach(
      (m) =>
        (m.scale.y = this.visual.reduzirMovimento
          ? 1
          : 1 + Math.sin(tempo * 25) * 0.09 + b[V.ESTILINGUE] * 0.002)
    );
    const espaco = lerEspaco(b);
    // A simulação cria rochas e planetas a 450–630 m, e o espaço não tem neblina: eles
    // crescem a partir dos 450 m em vez de brotar na tela.
    const surgir = (d: number) => Math.min(1, Math.max(0, (450 - d) / 150));
    const n = Math.min(100, espaco.asteroides.length);
    for (let i = 0; i < n; i++) {
      const r = espaco.asteroides[i];
      const s = r.r * surgir(r.z - z);
      this.instance(
        this.asteroides,
        i,
        (r.x - x) * 1.2 + sx,
        (r.y - y) * 1.2 + sy,
        -(r.z - z),
        s,
        s * 0.8,
        s * 1.2,
        // Giro fixo da rocha. Pelo índice na lista, todas giravam quando uma saía.
        r.x + r.z
      );
    }
    this.asteroides.count = n;
    this.asteroides.instanceMatrix.needsUpdate = true;
    let visiveis = 0,
      alvo: number[] | null = null;
    for (const p of espaco.planetas) {
      if (visiveis >= 32) break;
      const d = p.z - z;
      if (d < -60 || d > 650) continue;
      const px = (p.x - x) * 1.2 + sx,
        py = (p.y - y) * 1.2 + sy;
      this.instance(this.planetas, visiveis++, px, py, -d, p.r * surgir(d));
      if (!alvo && d > 0) alvo = [px, py, -d];
    }
    this.planetas.count = visiveis;
    this.planetas.instanceMatrix.needsUpdate = true;
    this.cabo.visible = b[V.ESTILINGUE] > 0 && Boolean(alvo);
    if (alvo)
      for (let i = 0; i < 40; i++) {
        const t = i / 39;
        this.pontosCabo[i * 3] = ler(sx, alvo[0], t) + Math.sin(t * Math.PI) * 5;
        this.pontosCabo[i * 3 + 1] = ler(sy, alvo[1], t);
        this.pontosCabo[i * 3 + 2] = ler(0, alvo[2], t);
      }
    this.cabo.geometry.attributes.position.needsUpdate = true;
    // +período: a cópia mais próxima some atrás da câmera, não na frente dela.
    this.poeira.position.z = (z % 160) + 160;
    this.rastros.position.z = (z % 140) + 140;
    this.rastros.visible = !this.visual.reduzirMovimento;
    // A singularidade cresce com o progresso do roteiro, qualquer que seja a duração.
    const progresso = THREE.MathUtils.clamp(b[V.PROGRESSO] / 100, 0, 1);
    const climax = THREE.MathUtils.smoothstep(progresso, 0.55, 0.92);
    const reduzido = this.visual.reduzirMovimento;
    const retrato = this.camera.aspect < 1;
    this.tempoDisco.value = reduzido ? 0 : tempo * 0.32;
    this.intensidadeCampo.value = climax;
    const pulso = reduzido ? 0 : Math.sin(tempo * 1.3) * 0.012 * climax;
    this.singularidade.scale.setScalar(1 + (reduzido ? 0.25 : 0.55) * progresso + pulso);
    this.singularidade.position.set(
      (retrato ? 65 : 150) - (reduzido ? 0 : climax * (retrato ? 25 : 45)),
      65,
      -560 + (reduzido ? 0 : climax * 140)
    );
    this.aneis.forEach((anel, i) => {
      anel.rotation.z =
        (i ? (i - 1) * 2.1 : -0.3) + (reduzido ? 0 : tempo * (i % 2 ? -0.035 : 0.025));
    });
    this.luzCampo.intensity = 1.4 + climax * 0.35;
    // Inclina somente os rastros decorativos, sem desviar a nave ou as entidades.
    this.rastros.rotation.y = reduzido ? 0 : -climax * 0.06;
    this.poeira.rotation.y = reduzido ? 0 : -climax * 0.025;
    this.gigante.rotation.y = tempo * 0.006;
    const orbit = this.visual.reduzirMovimento ? 0 : Math.sin(tempo * 0.055) * 0.16;
    this.cameraX = suave(this.cameraX, sx + (retrato ? 0.5 : 4 + orbit * 8), dt);
    this.cameraY = suave(this.cameraY, sy + (retrato ? 5 : 4.8), dt);
    this.camera.position.set(this.cameraX, this.cameraY, retrato ? 31 : 22);
    this.camera.lookAt(sx, sy + 1.2, retrato ? -3 : -12);
    this.camera.fov = suave(
      this.camera.fov,
      56 + (this.visual.reduzirMovimento ? 0 : Math.min(5, b[V.VELOCIDADE] * 0.05)),
      dt
    );
    this.camera.updateProjectionMatrix();
  }
}
