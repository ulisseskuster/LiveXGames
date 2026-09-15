import * as THREE from 'three/webgpu';
import {
  abs,
  color,
  float,
  fract,
  floor,
  normalWorld,
  positionWorld,
  sin,
  step,
  uv,
  uniform,
  smoothstep
} from 'three/tsl';
import type { Quadro } from '../shell/simHost';
import {
  CinemaScene,
  casco,
  ladrilhar,
  ler,
  luz,
  metal,
  peca,
  suave,
  type VisualCinema
} from '../shell/cinemaScene';
import { ambiente, letreiro } from '../shell/arte';
import { esportivo } from './modelo';
import { N, lerTrafego } from './estado';
export type Visual = VisualCinema;

/** Composição cinematográfica do replay. Não calcula score nem recompensas. */
export class CenaNeon extends CinemaScene {
  private readonly porticos: THREE.InstancedMesh;
  private readonly cobertura: THREE.InstancedMesh;
  private readonly emergencia: THREE.InstancedMesh;
  private readonly entradas: THREE.Mesh[] = [];
  private readonly umidade = uniform(0);
  private readonly luzAmbiente = new THREE.HemisphereLight(0x8fa9cb, 0x10111a, 0.85);
  private readonly luzCeu = new THREE.DirectionalLight(0xa8c9ed, 1.3);
  private readonly reflexoCarro: THREE.Mesh;
  private readonly underglow: THREE.Mesh;
  private readonly carro = new THREE.Group();
  private readonly rodas: THREE.Group[] = [];
  private readonly placas: THREE.Mesh[] = [];
  private readonly spray: THREE.Points;
  private readonly escape: THREE.Mesh[] = [];
  private readonly estrada: THREE.Mesh;
  private readonly faixas: THREE.InstancedMesh;
  private readonly muretas: THREE.InstancedMesh;
  private readonly predios: THREE.InstancedMesh;
  private readonly coroas: THREE.InstancedMesh;
  private readonly postes: THREE.InstancedMesh;
  private readonly luminarias: THREE.InstancedMesh;
  private readonly trafego: THREE.InstancedMesh;
  private readonly vidros: THREE.InstancedMesh;
  private readonly lanternas: THREE.InstancedMesh;
  private readonly reflexos: THREE.InstancedMesh;
  private readonly policia = new THREE.Group();
  private readonly sirene: THREE.Mesh;
  private readonly chuva: THREE.LineSegments;
  private cameraX = 7;
  private cameraY = 4.2;
  private cameraZ = 12;
  constructor(renderer: THREE.WebGPURenderer, canvas: HTMLCanvasElement, visual: Visual) {
    super(renderer, canvas, visual);
    this.scene.background = new THREE.Color(0x070b18);
    this.scene.fog = new THREE.Fog(0x101a2a, 90, 620);
    this.scene.add(this.luzAmbiente);
    const sol = this.luzCeu;
    sol.position.set(-80, 80, -180);
    this.scene.add(sol);
    const borda = new THREE.DirectionalLight(0xef99ba, 1.8);
    borda.position.set(20, 10, 30);
    this.scene.add(borda);
    ambiente(this.scene);
    const vidro = metal(0x122a3c);
    const caixa = new THREE.BoxGeometry(1, 1, 1);
    const modelo = esportivo(visual.assinante, visual.lendario);
    this.carro.add(modelo.grupo);
    this.rodas.push(...modelo.rodas);
    this.escape.push(...modelo.escapes);
    this.scene.add(this.carro);
    for (const [i, texto] of [
      'NIGHT DIVISION',
      'VEX / 01',
      'AFTER HOURS',
      'NEON DISTRICT'
    ].entries()) {
      const placa = new THREE.Mesh(
        new THREE.PlaneGeometry(19, 4.75),
        letreiro(texto, i % 2 ? '#84c9d9' : '#f48aad')
      );
      this.placas.push(placa);
      this.scene.add(placa);
    }
    const sprayGeo = new THREE.BufferGeometry();
    sprayGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(180 * 3), 3)
    );
    this.spray = new THREE.Points(
      sprayGeo,
      new THREE.PointsNodeMaterial({
        color: 0xa0b8cf,
        size: 0.09,
        transparent: true,
        opacity: 0.25,
        depthWrite: false
      })
    );
    this.scene.add(this.spray);
    this.underglow = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 7.5),
      new THREE.MeshBasicNodeMaterial({
        color: visual.assinante ? 0xffce71 : 0xeb3fac,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    (this.underglow.material as THREE.MeshBasicNodeMaterial).opacityNode = float(0.24).mul(
      float(1).sub(smoothstep(0.12, 0.5, uv().sub(0.5).length()))
    );
    this.underglow.rotation.x = -Math.PI / 2;
    this.underglow.position.y = 0.06;
    this.scene.add(this.underglow);
    this.porticos = this.instances(caixa, metal(0x1d2936), 36);
    // Quadras fixas no mundo: só as matrizes relativas ao carro são recicladas.
    this.cobertura = this.instances(caixa, metal(0x253244), 160);
    this.emergencia = this.instances(caixa, luz(0xff9567, 2), 64);
    const placaPassagem = letreiro('VEX / PASSAGEM 08', '#ffb184');
    for (let i = 0; i < 2; i++) {
      const placa = new THREE.Mesh(new THREE.PlaneGeometry(18, 2.5), placaPassagem);
      this.entradas.push(placa);
      this.scene.add(placa);
    }
    this.reflexoCarro = new THREE.Mesh(
      casco(2.8, 6, 0.7),
      new THREE.MeshBasicNodeMaterial({
        color: visual.assinante ? 0xffce71 : 0xeb8dbe,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    this.reflexoCarro.scale.y = -0.04;
    this.scene.add(this.reflexoCarro);
    const asfalto = new THREE.MeshStandardNodeMaterial({
      color: 0x101923,
      metalness: 0.12,
      roughness: 0.72
    });
    asfalto.envMapIntensity = 0.12;
    // Rugosidade irregular sugere poças sem reflexo plano que estoura o asfalto.
    const molhado = sin(positionWorld.x.mul(0.7).add(sin(positionWorld.z.mul(0.3))))
      .mul(sin(positionWorld.z.mul(0.65)))
      .mul(0.5)
      .add(0.5);
    asfalto.roughnessNode = float(0.84).sub(this.umidade.mul(0.3)).add(molhado.mul(0.14));
    this.estrada = new THREE.Mesh(new THREE.PlaneGeometry(31, 1800, 1, 120), asfalto);
    this.estrada.rotation.x = -Math.PI / 2;
    this.estrada.position.z = -650;
    this.scene.add(this.estrada);
    this.faixas = this.instances(caixa, luz(0xd5e3d5, 0.7), 180);
    this.muretas = this.instances(caixa, metal(0x263843), 120);
    this.postes = this.instances(caixa, metal(0x273445), 48);
    this.luminarias = this.instances(caixa, luz(0xa8edff, 4), 48);
    const fachada = new THREE.MeshStandardNodeMaterial({
      color: 0x172636,
      roughness: 0.5,
      metalness: 0.35
    });
    const coluna = floor(positionWorld.x.add(positionWorld.z).mul(0.42)),
      andar = floor(positionWorld.y.mul(0.5));
    const acesa = step(0.72, fract(sin(coluna.mul(12.9898).add(andar.mul(78.233))).mul(43758.54)));
    fachada.emissiveNode = color(0x8ac6d8)
      .mul(acesa)
      .mul(step(0.6, fract(positionWorld.y.mul(0.5))))
      .mul(step(0.32, fract(positionWorld.x.add(positionWorld.z).mul(0.42))))
      .mul(float(1).sub(abs(normalWorld.y)))
      .mul(0.19);
    this.predios = this.instances(caixa, fachada, 130);
    this.coroas = this.instances(caixa, metal(0x27374b), 130);
    this.trafego = this.instances(casco(2.7, 5.5, 0.7), metal(0x7386a0), 64);
    this.vidros = this.instances(casco(2.1, 2.6, 0.65), vidro, 64);
    this.lanternas = this.instances(caixa, luz(0xff5544, 3), 128);
    this.reflexos = this.instances(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicNodeMaterial({
        color: 0xb45d98,
        transparent: true,
        opacity: 0.12,
        depthWrite: false
      }),
      70
    );
    const reflexoMat = this.reflexos.material as THREE.MeshBasicNodeMaterial;
    reflexoMat.opacityNode = float(0.14)
      .add(this.umidade.mul(0.1))
      .mul(float(1).sub(smoothstep(0.1, 0.5, uv().sub(0.5).length())));
    peca(this.policia, casco(2.8, 5.8, 0.75), metal(0x172333), [0, 0.5, 0]);
    peca(this.policia, casco(2.2, 2.8, 0.6), vidro, [0, 1.1, 0]);
    this.sirene = peca(this.policia, caixa, luz(0x2288ff, 5), [0, 1.8, 0.1], [1.6, 0.1, 0.3]);
    peca(this.policia, caixa, luz(0xe8ffff, 3), [0, 0.9, -2.85], [2.2, 0.09, 0.08]);
    this.scene.add(this.policia);
    const lua = new THREE.Mesh(
      new THREE.SphereGeometry(19, 24, 16),
      new THREE.MeshBasicNodeMaterial({ color: 0x6b809e })
    );
    lua.position.set(-150, 140, -600);
    this.scene.add(lua);
    // Bloco de 20 m repetido cinco vezes: a queda (tempo % 20) emenda sem salto.
    const gotas: number[] = [];
    for (let i = 0; i < 156; i++) {
      const x = ((i * 17.3) % 90) - 45,
        y = (i * 7.7) % 20,
        z = -((i * 13.7) % 150);
      gotas.push(x, y, z, x - 0.2, y - 1.7, z + 0.4);
    }
    const chuvaGeo = new THREE.BufferGeometry();
    chuvaGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(ladrilhar(gotas, 1, 20, 5), 3)
    );
    this.chuva = new THREE.LineSegments(
      chuvaGeo,
      new THREE.LineBasicNodeMaterial({ color: 0x9dcddb, transparent: true, opacity: 0.18 })
    );
    this.scene.add(this.chuva);
  }
  atualizar(q: Quadro, now: number) {
    const b = q.atual,
      a = q.anterior,
      dt = this.dt(now);
    const z = ler(a[N.Z], b[N.Z], q.alfa),
      x = ler(a[N.X], b[N.X], q.alfa);
    const tempo = q.tick < 0 ? 0 : q.tick / 60;
    // 288–672 m de cada distrito: cenário, sem novos eventos ou colisões.
    const distrito = ((z % 1200) + 1200) % 1200;
    const coberto =
      THREE.MathUtils.smoothstep(distrito, 288, 336) *
      (1 - THREE.MathUtils.smoothstep(distrito, 624, 672));
    this.umidade.value = coberto;
    this.luzAmbiente.intensity = 0.85 - coberto * 0.32;
    this.luzCeu.intensity = 1.3 - coberto * 0.8;
    const pulso = this.visual.reduzirMovimento ? 1 : 0.85 + Math.sin(tempo * 1.8) * 0.15;
    (this.emergencia.material as THREE.MeshBasicNodeMaterial).color
      .setHex(0xff9567)
      .multiplyScalar(2 * pulso);
    const curva = (d: number) => Math.sin((z + d) * 0.0019) * 20 - Math.sin(z * 0.0019) * 20;
    let estruturas = 0,
      lampadas = 0;
    const primeiraQuadra = Math.floor((z - 60) / 24);
    for (let i = 0; i < 32; i++) {
      const quadra = primeiraQuadra + i;
      const local = ((quadra % 50) + 50) % 50;
      if (local < 12 || local >= 28) continue;
      const d = quadra * 24 + 12 - z;
      const cx = curva(d);
      this.instance(this.cobertura, estruturas++, cx, 12.2, -d, 34, 0.7, 24.1);
      for (const lado of [-1, 1]) {
        this.instance(this.cobertura, estruturas++, cx + lado * 22, 5.5, -d, 10, 11, 24);
        this.instance(this.cobertura, estruturas++, cx + lado * 16.5, 6, -d, 0.7, 12, 1.2);
        this.instance(this.emergencia, lampadas++, cx + lado * 15.8, 10.7, -d, 0.16, 0.22, 12);
      }
    }
    this.cobertura.count = estruturas;
    this.emergencia.count = lampadas;
    this.cobertura.instanceMatrix.needsUpdate = this.emergencia.instanceMatrix.needsUpdate = true;
    this.entradas.forEach((placa, i) => {
      const d = (Math.floor((z - 700) / 1200) + i + 1) * 1200 + 288 - z;
      placa.position.set(curva(d), 9.5, -d + 0.5);
      placa.visible = d > -60 && d < 650;
    });
    const pos = this.estrada.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++)
      pos.setX(i, (i % 2 ? 15.5 : -15.5) + curva(pos.getY(i) + 650));
    pos.needsUpdate = true;
    this.carro.position.set(x * 0.72, 0, 0);
    this.underglow.position.x = x * 0.72;
    (this.underglow.material as THREE.MeshBasicNodeMaterial).color.setHSL(
      this.visual.assinante ? 0.12 : 0.78 + Math.sin(tempo * 0.2) * 0.12,
      0.85,
      0.62
    );
    for (let i = 0; i < 12; i++) {
      const d = i * 200 - (z % 200) - 30;
      this.instance(this.porticos, i * 3, curva(d) - 16, 8, -d, 0.65, 16, 0.8);
      this.instance(this.porticos, i * 3 + 1, curva(d) + 16, 8, -d, 0.65, 16, 0.8);
      this.instance(this.porticos, i * 3 + 2, curva(d), 16, -d, 32, 0.65, 0.8);
    }
    this.porticos.instanceMatrix.needsUpdate = true;
    this.carro.rotation.y = suave(this.carro.rotation.y, -b[N.VX] * 0.018, dt);
    this.carro.rotation.z = suave(this.carro.rotation.z, -b[N.VX] * 0.002, dt);
    this.reflexoCarro.position.set(x * 0.72, 0.055, 0.4);
    this.reflexoCarro.rotation.y = this.carro.rotation.y;
    (this.reflexoCarro.material as THREE.MeshBasicNodeMaterial).opacity =
      0.02 + coberto * 0.025 + Math.min(1, b[N.NEON] / 100) * 0.01;
    for (const r of this.rodas) r.rotation.x = -z * 1.8;
    this.placas.forEach((placa, i) => {
      const d = i * 140 - (z % 560) + 60;
      placa.position.set((i % 2 ? -1 : 1) * 28 + curva(d), 9 + (i % 2) * 6, -d);
    });
    const pontos = this.spray.geometry.attributes.position;
    for (let i = 0; i < pontos.count; i++) {
      const t = (i * 0.037 + tempo * 1.7) % 1;
      pontos.setXYZ(
        i,
        x * 0.72 + (i % 2 ? -1.5 : 1.5) + Math.sin(i * 7) * t,
        0.3 + t * 0.65,
        2 + t * 7
      );
    }
    pontos.needsUpdate = true;
    this.spray.visible = q.tick >= 0 && !this.visual.reduzirMovimento;
    this.escape.forEach((e) => {
      e.visible = b[N.NITRO] > 0;
      e.scale.y = 1 + Math.sin(tempo * 40) * 0.2;
    });
    for (let i = 0; i < 180; i++) {
      const d = Math.floor(i / 3) * 18 - (z % 18) - 30;
      this.instance(this.faixas, i, ((i % 3) - 1) * 7 + curva(d), 0.025, -d, 0.11, 0.03, 6);
    }
    for (let i = 0; i < 120; i++) {
      const d = Math.floor(i / 2) * 20 - (z % 20) - 30,
        side = i % 2 ? -1 : 1;
      this.instance(this.muretas, i, side * 16 + curva(d), 0.7, -d, 0.65, 1.4, 19.7);
    }
    for (let i = 0; i < 48; i++) {
      const d = Math.floor(i / 2) * 50 - (z % 50) - 35,
        side = i % 2 ? -1 : 1;
      this.instance(this.postes, i, side * 17 + curva(d), 6, -d, 0.18, 12, 0.22);
      this.instance(this.luminarias, i, side * 14.5 + curva(d), 12, -d, 5.3, 0.13, 0.5);
    }
    // A fileira sai da posição no mundo. Com o índice relativo ao carro, cada prédio
    // mudava de altura, largura e afastamento a cada 24 m.
    const quadra = Math.floor(z / 24);
    for (let i = 0; i < 130; i++) {
      const idx = quadra + Math.floor(i / 2),
        d = idx * 24 - z - 55;
      const side = i % 2 ? -1 : 1,
        h = 14 + ((idx * 37) % 79),
        px = side * (29 + (idx % 3) * 19) + curva(d),
        largura = 10 + (idx % 4) * 3;
      this.instance(this.predios, i, px, h / 2 - 5, -d, largura, h, 16);
      this.instance(this.coroas, i, px, h - 5, -d, largura, 0.22, 16.2);
    }
    for (let i = 0; i < 70; i++) {
      const d = i * 13 - (z % 13) - 30;
      this.aux.position.set((i % 2 ? -12 : 12) + curva(d), 0.04, -d);
      this.aux.rotation.set(-Math.PI / 2, 0, 0);
      this.aux.scale.set(3.5, 11, 1);
      this.aux.updateMatrix();
      this.reflexos.setMatrixAt(i, this.aux.matrix);
    }
    const carros = lerTrafego(b);
    const n = Math.min(64, carros.length);
    for (let i = 0; i < n; i++) {
      const d = carros[i].z - z,
        tx = carros[i].x * 0.72 + curva(d);
      this.instance(this.trafego, i, tx, 0.5, -d);
      this.instance(this.vidros, i, tx, 1.15, -d);
      for (let j = 0; j < 2; j++)
        this.instance(
          this.lanternas,
          i * 2 + j,
          tx + (j ? -0.8 : 0.8),
          1,
          -d + 2.7,
          0.7,
          0.12,
          0.08
        );
    }
    this.trafego.count = this.vidros.count = n;
    this.lanternas.count = n * 2;
    for (const mesh of [
      this.faixas,
      this.muretas,
      this.predios,
      this.coroas,
      this.postes,
      this.luminarias,
      this.reflexos,
      this.trafego,
      this.vidros,
      this.lanternas
    ])
      mesh.instanceMatrix.needsUpdate = true;
    // A perseguição entra na fase 2 do roteiro, qualquer que seja a duração da corrida.
    this.policia.visible = b[N.FASE] >= 2;
    this.policia.position.set(-7 + Math.sin(tempo * 0.25) * 2, 0, -26 + Math.sin(tempo * 0.3) * 10);
    (this.sirene.material as THREE.MeshBasicNodeMaterial).color
      .setHex(this.visual.reduzirMovimento || Math.sin(tempo * 15) > 0 ? 0x2288ff : 0xff243c)
      .multiplyScalar(5);
    this.chuva.visible = !this.visual.reduzirMovimento;
    (this.chuva.material as THREE.LineBasicNodeMaterial).opacity = 0.18 * (1 - coberto);
    this.chuva.position.y = -((tempo * 19) % 20);
    const orbit =
      q.tick < 0 ? 0.35 : this.visual.reduzirMovimento ? 0 : Math.sin(tempo * 0.09) * 0.28;
    const retrato = this.camera.aspect < 1;
    this.cameraX = suave(this.cameraX, x * 0.72 + orbit * (retrato ? 2 : 8), dt);
    this.cameraY = suave(this.cameraY, 3.3 + Math.abs(orbit) * 2, dt);
    this.cameraZ = suave(this.cameraZ, (retrato ? 17 : 12.5) + Math.abs(orbit) * 3, dt);
    this.camera.position.set(this.cameraX, this.cameraY, this.cameraZ);
    this.camera.lookAt(x * 0.72, 1.05, retrato ? -5 : -10);
    this.camera.fov = suave(this.camera.fov, 57 + Math.min(9, b[N.VELOCIDADE] * 0.07), dt);
    this.camera.updateProjectionMatrix();
  }
}
