// Inputs of the volume-equivalence bench (batch M2): drawn from a seed, and deliberately
// hostile. Empty, inverted, point, infinite boxes, NaN or signed-zero bounds; placement
// matrices with negative or non-uniform scale, singular, projective, full of NaN;
// perspective and orthographic views in both depth conventions; boxes that contain
// the eye, hence clip the near plane.
import * as THREE from 'three';
import { graine } from '../../../core/index.ts';

const alea = graine(52021);
/** Values a float can take that a volume must traverse without smoothing them. */
const BORDS = [0, -0, 1, -1, Infinity, -Infinity, NaN, 5e-324, 1e308, -1e308];
const nombre = (): number => {
  if (alea() < 0.15) return BORDS[Math.floor(alea() * BORDS.length)];
  return (alea() * 2 - 1) * 10 ** Math.floor(alea() * 10 - 4);
};
const dans = (etendue: number) => (alea() * 2 - 1) * etendue;

/** Six bounds: ordinary, then the degenerate shapes the engine may receive from a manifest. */
export const boites: number[][] = [
  [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity],
  [1, 1, 1, 0, 0, 0],
  [-1, -1, -1, 1, -2, 1],
  [2, 3, 4, 2, 3, 4],
  [-0, -0, -0, 0, 0, 0],
  [0, 0, 0, -0, -0, -0],
  [-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity],
  [NaN, 0, 0, 1, 1, 1],
  [0, 0, 0, 1, NaN, 1],
  [-0.5, -0.5, 5.5, 0.5, 0.5, 6.5],
  [-1e308, -1e308, -1e308, 1e308, 1e308, 1e308],
];
for (let i = 0; i < 300; i++) {
  if (i % 5 === 0) {
    boites.push([nombre(), nombre(), nombre(), nombre(), nombre(), nombre()]);
    continue;
  }
  const c = [dans(20), dans(20), dans(20)],
    e = [alea() * 4, alea() * 4, alea() * 4];
  boites.push([c[0] - e[0], c[1] - e[1], c[2] - e[2], c[0] + e[0], c[1] + e[1], c[2] + e[2]]);
}

const placement = (sx: number, sy: number, sz: number): number[] => {
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(dans(Math.PI), dans(Math.PI), dans(Math.PI)),
  );
  return new THREE.Matrix4()
    .compose(new THREE.Vector3(dans(50), dans(50), dans(50)), q, new THREE.Vector3(sx, sy, sz))
    .toArray();
};

/** 4×4 column-major placement matrices. */
export const matrices: number[][] = [
  new THREE.Matrix4().toArray(),
  new Array(16).fill(0),
  new Array(16).fill(-0),
  new THREE.Matrix4().makeScale(1, 0, 1).toArray(),
  new THREE.Matrix4().makeScale(-1, 1, 1).toArray(),
  new THREE.Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.2, -0.1, 0.3, 1).toArray(),
];
for (let i = 0; i < 40; i++) {
  const u = alea() * 3 + 0.01;
  matrices.push(placement(u, u, u));
  matrices.push(placement(dans(3), dans(3), dans(3)));
  const hostile = placement(u, -u, u);
  hostile[Math.floor(alea() * 16)] = nombre();
  matrices.push(hostile);
}

/** One view: a WebGL/WebGPU view-projection, and the eye it was built from. */
export interface ViewProjectionCase {
  vp: number[];
  webgpu: boolean;
  oeil: number[];
}

/** View-projections: perspective and orthographic, WebGL then WebGPU depth, and hostile. */
export const vuesProjections: ViewProjectionCase[] = [];
for (let i = 0; i < 60; i++) {
  const camera =
    i % 4 === 3
      ? new THREE.OrthographicCamera(-10, 10, 6, -6, 0.1, 300)
      : new THREE.PerspectiveCamera(20 + alea() * 90, 0.5 + alea() * 2, 0.01 + alea(), 500);
  camera.coordinateSystem = i % 2 ? THREE.WebGPUCoordinateSystem : THREE.WebGLCoordinateSystem;
  camera.updateProjectionMatrix();
  camera.position.set(dans(30), dans(30), dans(30));
  camera.lookAt(dans(5), dans(5), dans(5));
  camera.updateMatrixWorld();
  const vp = new THREE.Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .toArray();
  if (i % 9 === 8) vp[Math.floor(alea() * 16)] = nombre();
  const oeil = camera.position;
  vuesProjections.push({ vp, webgpu: i % 2 === 1, oeil: [oeil.x, oeil.y, oeil.z] });
}
vuesProjections.push({ vp: new Array(16).fill(0), webgpu: false, oeil: [0, 0, 0] });
vuesProjections.push({ vp: new Array(16).fill(NaN), webgpu: true, oeil: [0, 0, 0] });

/** One view against one box: the shared ones, and a box around the eye that clips the near plane. */
export interface ViewBoxCase {
  vp: number[];
  webgpu: boolean;
  boite: number[];
}

/** Each view against boxes: the shared ones, and a box around the eye that clips the near plane. */
export const boitesDeVue: ViewBoxCase[] = vuesProjections.flatMap(({ vp, webgpu, oeil }, v) => {
  const [x, y, z] = oeil;
  const autour = [x - 1, y - 1, z - 1, x + 1, y + 1, z + 1];
  return [autour, ...boites.filter((_, i) => i % 7 === v % 7)].map((boite) => ({
    vp,
    webgpu,
    boite,
  }));
});

/** One cone-rejection case: conformal placement, cone, box, eye. */
export interface ConeCase {
  axe: number[];
  angle: number;
  min: number[];
  max: number[];
  world: THREE.Matrix4;
  normal: THREE.Matrix3;
  echelle: number;
  oeil: number[];
}

/** Cone rejections: conformal placement, cone, box, eye — sometimes in the sphere, sometimes hostile. */
export const casCones: ConeCase[] = [];
for (let i = 0; i < 1500; i++) {
  const u = i % 13 === 0 ? nombre() : alea() * 3 + 0.01;
  const world = new THREE.Matrix4().fromArray(placement(u, u, i % 3 === 0 ? -u : u));
  const axe = [dans(1), dans(1), dans(1)];
  if (i % 17 === 0) axe[i % 3] = nombre();
  const boite = boites[i % boites.length];
  const centre = new THREE.Vector3(
    (boite[0] + boite[3]) * 0.5,
    (boite[1] + boite[4]) * 0.5,
    (boite[2] + boite[5]) * 0.5,
  ).applyMatrix4(world);
  const oeil =
    i % 11 === 0
      ? [centre.x, centre.y, centre.z]
      : [centre.x + dans(80), centre.y + dans(80), centre.z + dans(80)];
  casCones.push({
    axe,
    angle: i % 19 === 0 ? nombre() : alea() * (Math.PI / 2),
    min: boite.slice(0, 3),
    max: boite.slice(3, 6),
    world,
    normal: new THREE.Matrix3().getNormalMatrix(world),
    echelle: u,
    oeil,
  });
}
