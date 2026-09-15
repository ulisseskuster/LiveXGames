import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Arte original gerada localmente: nenhuma textura externa ou regra de simulação. */
export const bloco = (x: number, y: number, z: number, raio = 0.12) =>
  new RoundedBoxGeometry(x, y, z, 2, Math.min(raio, x / 3, y / 3, z / 3));

export function malha(
  grupo: THREE.Object3D,
  geometria: THREE.BufferGeometry,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0
) {
  const m = new THREE.Mesh(geometria, material);
  m.position.set(x, y, z);
  grupo.add(m);
  return m;
}

/** Seções elípticas dão volume ao casco sem empilhar caixas. Frente em -Z. */
export function fuselagem(secoes: number[][], lados = 16) {
  const pos: number[] = [],
    indices: number[] = [];
  secoes.forEach(([z, largura, altura, centro], j) => {
    for (let i = 0; i < lados; i++) {
      const a = (i / lados) * Math.PI * 2;
      pos.push(Math.cos(a) * largura, centro + Math.sin(a) * altura, z);
      if (j) {
        const p = j * lados + i,
          n = j * lados + ((i + 1) % lados);
        indices.push(p, p - lados, n, n, p - lados, n - lados);
      }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function asa(pontos: number[][], espessura = 0.12) {
  const shape = new THREE.Shape();
  pontos.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: espessura,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.06,
    bevelThickness: 0.04
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export function pintura(cor: number, dourado = false) {
  return new THREE.MeshPhysicalNodeMaterial({
    color: dourado ? 0xd6a34f : cor,
    metalness: 0.65,
    roughness: 0.29,
    clearcoat: 1,
    clearcoatRoughness: 0.18
  });
}

/** Ambiente de reflexão pequeno, contínuo na emenda e independente da câmera. */
export function ambiente(scene: THREE.Scene, quente = false) {
  const w = 128,
    h = 64,
    data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const elevacao = Math.sin((y / h) * Math.PI);
      const faixa = Math.pow(Math.max(0, Math.cos((x / w) * Math.PI * 2 - 1)), 20);
      const luz = 18 + 65 * elevacao + 150 * faixa * elevacao;
      const i = (y * w + x) * 4;
      data.set(
        [luz, luz * (quente ? 0.85 : 0.94), Math.min(255, luz * (quente ? 0.7 : 1.12)), 255],
        i
      );
    }
  const mapa = new THREE.DataTexture(data, w, h);
  mapa.mapping = THREE.EquirectangularReflectionMapping;
  mapa.colorSpace = THREE.SRGBColorSpace;
  mapa.needsUpdate = true;
  scene.environment = mapa;
  scene.environmentIntensity = 0.8;
}

export function letreiro(texto: string, cor: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#081321';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = cor;
  ctx.lineWidth = 3;
  ctx.strokeRect(5, 5, 502, 118);
  ctx.fillStyle = cor;
  ctx.font = '600 52px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(texto, 256, 66);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicNodeMaterial({ map });
}

/** Ruído em coordenadas esféricas: a textura fecha sem costura nos polos e na emenda. */
export function superficiePlaneta(gas: boolean) {
  const w = 512,
    h = 256,
    dados = new Uint8Array(w * h * 4);
  const hash = (x: number, y: number, z: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const ruido = (x: number, y: number, z: number): number => {
    const ix = Math.floor(x),
      iy = Math.floor(y),
      iz = Math.floor(z);
    const curva = (v: number) => v * v * (3 - 2 * v);
    const fx = curva(x - ix),
      fy = curva(y - iy),
      fz = curva(z - iz);
    let n = 0;
    for (let a = 0; a < 2; a++)
      for (let b = 0; b < 2; b++)
        for (let c = 0; c < 2; c++)
          n +=
            hash(ix + a, iy + b, iz + c) *
            (a ? fx : 1 - fx) *
            (b ? fy : 1 - fy) *
            (c ? fz : 1 - fz);
    return n;
  };
  const fbm = (x: number, y: number, z: number) =>
    ruido(x, y, z) * 0.56 +
    ruido(x * 2, y * 2, z * 2) * 0.27 +
    ruido(x * 4, y * 4, z * 4) * 0.12 +
    ruido(x * 8, y * 8, z * 8) * 0.05;
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++) {
      const phi = (py / (h - 1)) * Math.PI,
        theta = (px / (w - 1)) * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(theta),
        y = Math.cos(phi),
        z = Math.sin(phi) * Math.sin(theta);
      const turbulencia = fbm(x * 3 + 7, y * 3 + 11, z * 3 + 5);
      const detalhe = fbm(x * 18, y * 18, z * 18);
      let r: number, g: number, b: number;
      if (gas) {
        const bandas = Math.sin(y * 31 + turbulencia * 13 + detalhe * 2) * 0.5 + 0.5;
        const n = bandas * 0.5 + turbulencia * 0.5;
        r = 90 + n * 125;
        g = 78 + n * 115;
        b = 67 + n * 100;
      } else {
        const terra = Math.max(0, Math.min(1, (turbulencia - 0.48) * 16));
        const nuvem = Math.max(0, (fbm(x * 7 + 20, y * 7, z * 7) - 0.57) * 3);
        r = 14 + terra * (65 + detalhe * 40) + nuvem * 130;
        g = 40 + terra * (48 + detalhe * 22) + nuvem * 125;
        b = 64 + terra * 15 + nuvem * 115;
      }
      dados.set([r, g, b, 255], (py * w + px) * 4);
    }
  const map = new THREE.DataTexture(dados, w, h);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

export function liberarArte(scene: THREE.Scene) {
  const geometrias = new Set<THREE.BufferGeometry>();
  const materiais = new Set<THREE.Material>();
  const texturas = new Set<THREE.Texture>();
  if (scene.environment) texturas.add(scene.environment);
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) geometrias.add(mesh.geometry);
    if (mesh.material)
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => {
        materiais.add(m);
        Object.values(m).forEach((v) => {
          if (v instanceof THREE.Texture) texturas.add(v);
        });
      });
  });
  geometrias.forEach((g) => g.dispose());
  materiais.forEach((m) => m.dispose());
  texturas.forEach((t) => t.dispose());
  scene.clear();
}
