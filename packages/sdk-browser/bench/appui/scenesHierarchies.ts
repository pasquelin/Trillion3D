// Parent/child hierarchies of the volume bench (batch M2). World matrices come from Three.js —
// `updateMatrixWorld(true)` on real `Object3D` chains — the in-house hierarchy belonging to
// batch M3: what is verified here is that volumes stay exact under any realistic world
// matrix. Depth chains 1 to 6 and a multi-child branch; negative scales on one or three
// axes, non-uniform under a parent rotation (shear), zero, extremes; a perspective or
// orthographic camera posed itself in the hierarchy, in both depth conventions.
import * as THREE from 'three';
import { graine } from '../../../sdk-core/bench/socle.ts';
import { boites } from './scenesVolumes.ts';

const alea = graine(60617);
const dans = (etendue: number) => (alea() * 2 - 1) * etendue;

/** Scales of a node: ordinary, negative on one or three axes, non-uniform, zero, extremes. */
const ECHELLES: (() => [number, number, number])[] = [
  () => [1, 1, 1],
  () => [-1, 1, 1],
  () => [-2, -0.5, -3],
  () => [0.1 + alea() * 4, 0.1 + alea() * 0.2, 1 + alea() * 9],
  () => [1, 0, 1],
  () => [1e-150, 1e150, 1],
  () => [-0.001, 1000, -7],
];

function noeud(profondeur: number) {
  const n = new THREE.Object3D();
  n.position.set(dans(40), dans(40), dans(40));
  n.rotation.set(dans(Math.PI), dans(Math.PI), dans(Math.PI));
  n.scale.fromArray(ECHELLES[(profondeur + Math.floor(alea() * 7)) % ECHELLES.length]());
  return n;
}

const racine = new THREE.Object3D(),
  noeuds: THREE.Object3D[] = [];
/** Depth chains 1 to 6 under the root. */
for (let chaine = 0; chaine < 24; chaine++) {
  let parent = racine;
  const profondeur = 1 + (chaine % 6);
  for (let d = 0; d < profondeur; d++) {
    const n = noeud(d);
    parent.add(n);
    noeuds.push(n);
    parent = n;
  }
}
/** A multi-child branch, including a rotated parent at non-uniform scale: shear. */
const branche = noeud(3);
branche.scale.set(3, 0.25, 1);
racine.add(branche);
noeuds.push(branche);
for (let i = 0; i < 5; i++) {
  const enfant = noeud(i);
  enfant.rotation.set(dans(Math.PI), dans(Math.PI), dans(Math.PI));
  branche.add(enfant);
  noeuds.push(enfant);
  const petit = noeud(i + 2);
  enfant.add(petit);
  noeuds.push(petit);
}

/** Cameras posed in the hierarchy, under parents of every scale. */
const cameras: (THREE.OrthographicCamera | THREE.PerspectiveCamera)[] = [];
for (let i = 0; i < 16; i++) {
  const camera =
    i % 4 === 3
      ? new THREE.OrthographicCamera(-12, 12, 8, -8, 0.1, 400)
      : new THREE.PerspectiveCamera(30 + alea() * 70, 0.6 + alea() * 1.6, 0.05 + alea(), 600);
  camera.coordinateSystem = i % 2 ? THREE.WebGPUCoordinateSystem : THREE.WebGLCoordinateSystem;
  camera.updateProjectionMatrix();
  camera.position.set(dans(10), dans(10), dans(10));
  camera.rotation.set(dans(Math.PI), dans(Math.PI), dans(Math.PI));
  noeuds[(i * 7) % noeuds.length].add(camera);
  cameras.push(camera);
}
racine.updateMatrixWorld(true);

/** The world matrix of each node, as Three.js composes it. */
export const mondesHierarchiques = noeuds.map((n) => n.matrixWorld.toArray());

/** Each node against a few boxes: what the box transform and the sphere receive. */
export const boitesHierarchiques: [number[], number[]][] = mondesHierarchiques.flatMap((m, i) =>
  boites
    .filter((_: number[], j: number) => j % 9 === i % 9)
    .map((b: number[]): [number[], number[]] => [b, m]),
);

/** View-projections of the hierarchy cameras, and world boxes of the nodes, one around the eye. */
export const vuesHierarchiques = cameras.map((camera) => {
  const oeil = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  return {
    vp: new THREE.Matrix4()
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .toArray(),
    webgpu: camera.coordinateSystem === THREE.WebGPUCoordinateSystem,
    oeil: [oeil.x, oeil.y, oeil.z],
  };
});
export const boitesDeVueHierarchiques = vuesHierarchiques.flatMap(({ vp, webgpu, oeil }, v) => {
  const [x, y, z] = oeil;
  const monde = new THREE.Box3();
  const choisies = boitesHierarchiques.filter((_, j) => j % 23 === v % 23);
  return [
    [x - 0.5, y - 0.5, z - 0.5, x + 0.5, y + 0.5, z + 0.5],
    ...choisies.map(([b, m]) => {
      monde.min.set(b[0], b[1], b[2]);
      monde.max.set(b[3], b[4], b[5]);
      monde.applyMatrix4(new THREE.Matrix4().fromArray(m));
      return [...monde.min.toArray(), ...monde.max.toArray()];
    }),
  ].map((boite) => ({ vp, webgpu, boite }));
});

/** Cones under the hierarchy world matrices: Three's normal matrix, a camera's eye. */
export const conesHierarchiques = boitesHierarchiques.map(([b, m], i) => {
  const world = new THREE.Matrix4().fromArray(m);
  const e = world.elements;
  return {
    axe: [dans(1), dans(1), dans(1)],
    angle: alea() * (Math.PI / 2),
    min: b.slice(0, 3),
    max: b.slice(3, 6),
    world,
    normal: new THREE.Matrix3().getNormalMatrix(world),
    echelle: Math.hypot(e[0], e[1], e[2]),
    oeil: vuesHierarchiques[i % vuesHierarchiques.length].oeil,
  };
});
