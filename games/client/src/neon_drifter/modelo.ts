import * as THREE from 'three/webgpu';
import { bloco, fuselagem, malha, pintura } from '../shell/arte';
import { luz } from '../shell/cinemaScene';

/** VEX-01: carroceria contínua, para-lamas e rodas com aros solidários. */
export function esportivo(dourado: boolean, lendario: boolean) {
  const grupo = new THREE.Group(),
    rodas: THREE.Group[] = [],
    escapes: THREE.Mesh[] = [];
  const tinta = pintura(0x872650, dourado);
  tinta.iridescence = lendario ? 0.7 : 0;
  const carbono = new THREE.MeshStandardNodeMaterial({ color: 0x080e17, roughness: 0.65 });
  const vidro = pintura(0x122e42);
  vidro.roughness = 0.14;
  const metal = pintura(0x8c9ca9);
  malha(
    grupo,
    fuselagem(
      [
        [-3.3, 0.05, 0.02, 0.63],
        [-3.15, 1.32, 0.24, 0.65],
        [-2.25, 1.55, 0.34, 0.69],
        [-0.8, 1.43, 0.33, 0.72],
        [1.4, 1.55, 0.4, 0.73],
        [2.8, 1.56, 0.36, 0.72],
        [3.2, 1.43, 0.27, 0.72],
        [3.25, 0.01, 0.01, 0.72]
      ],
      24
    ),
    tinta
  );
  malha(
    grupo,
    fuselagem([
      [-1.7, 0.1, 0.02, 1],
      [-1.15, 1.06, 0.12, 1.17],
      [-0.45, 0.96, 0.29, 1.35],
      [0.7, 0.96, 0.28, 1.37],
      [1.75, 1.16, 0.09, 1.11],
      [1.8, 0.01, 0.01, 1.05]
    ]),
    vidro
  );
  malha(grupo, bloco(1.8, 0.09, 1.24, 0.04), tinta, 0, 1.61, 0.15);
  malha(grupo, bloco(2.75, 0.2, 0.25, 0.06), carbono, 0, 0.43, 3.23);
  malha(grupo, bloco(2.65, 0.14, 0.4, 0.04), carbono, 0, 0.36, -3.1);
  malha(grupo, bloco(3.25, 0.12, 0.48, 0.04), carbono, 0, 1.49, 2.82);
  for (const side of [-1, 1]) {
    malha(grupo, bloco(0.09, 0.47, 0.14, 0.02), carbono, side * 1.1, 1.23, 2.82);
    malha(grupo, bloco(0.11, 0.13, 4.5, 0.04), carbono, side * 1.5, 0.37, 0);
    malha(grupo, bloco(0.36, 0.14, 0.4, 0.06), tinta, side * 1.4, 1.17, -0.95);
    malha(grupo, bloco(1.13, 0.08, 0.06, 0.02), luz(0xff304e, 2), side * 0.79, 0.91, 3.19);
    malha(grupo, bloco(0.9, 0.06, 0.08, 0.02), luz(0xc5e8ff, 2.5), side * 0.87, 0.85, -3.16);
    for (const z of [-1.98, 1.98]) {
      const roda = new THREE.Group();
      roda.position.set(side * 1.46, 0.55, z);
      const pneu = malha(roda, new THREE.TorusGeometry(0.4, 0.16, 10, 28), carbono);
      pneu.rotation.y = Math.PI / 2;
      const aro = malha(roda, new THREE.CylinderGeometry(0.33, 0.33, 0.32, 24), metal);
      aro.rotation.z = Math.PI / 2;
      const disco = malha(roda, new THREE.CylinderGeometry(0.25, 0.25, 0.34, 24), carbono);
      disco.rotation.z = Math.PI / 2;
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5;
        const raio = malha(roda, bloco(0.04, 0.45, 0.06, 0.01), metal, side * 0.18, 0, 0);
        raio.rotation.x = a;
      }
      grupo.add(roda);
      rodas.push(roda);
      const arco = malha(
        grupo,
        new THREE.TorusGeometry(0.62, 0.07, 6, 24, Math.PI),
        tinta,
        side * 1.5,
        0.56,
        z
      );
      arco.rotation.y = Math.PI / 2;
    }
    const bocal = malha(
      grupo,
      new THREE.CylinderGeometry(0.13, 0.16, 0.35, 12),
      metal,
      side * 0.84,
      0.47,
      3.22
    );
    bocal.rotation.x = Math.PI / 2;
    const chama = malha(
      grupo,
      new THREE.ConeGeometry(0.11, 1.6, 12),
      luz(0x68aeff, 2),
      side * 0.84,
      0.47,
      4
    );
    chama.rotation.x = Math.PI / 2;
    escapes.push(chama);
  }
  for (let i = -2; i <= 2; i++)
    malha(grupo, bloco(0.05, 0.22, 0.5, 0.01), carbono, i * 0.3, 0.33, 3.13);
  return { grupo, rodas, escapes };
}
