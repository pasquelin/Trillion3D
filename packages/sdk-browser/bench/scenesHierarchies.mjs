// Hiérarchies parent/enfant du banc des volumes (lot M2). Les matrices monde viennent de Three.js —
// `updateMatrixWorld(true)` sur de vraies chaînes d'`Object3D` —, la hiérarchie maison relevant du
// lot M3 : ce qui se vérifie ici, c'est que les volumes restent exacts sous toute matrice monde
// réaliste. Chaînes de profondeur 1 à 6 et une branche à plusieurs enfants ; échelles négatives sur
// un ou trois axes, non uniformes sous une rotation parente (cisaillement), nulle, extrêmes ; une
// caméra perspective ou orthographique posée elle-même dans la hiérarchie, dans les deux conventions
// de profondeur.
import * as THREE from 'three';
import { graine } from '../../sdk-core/bench/mesure.mjs';
import { boites } from './scenesVolumes.mjs';

const alea = graine(60617);
const dans = (etendue) => (alea() * 2 - 1) * etendue;

/** Échelles d'un nœud : ordinaires, négatives sur un ou trois axes, non uniformes, nulle, extrêmes. */
const ECHELLES = [
  () => [1, 1, 1],
  () => [-1, 1, 1],
  () => [-2, -0.5, -3],
  () => [0.1 + alea() * 4, 0.1 + alea() * 0.2, 1 + alea() * 9],
  () => [1, 0, 1],
  () => [1e-150, 1e150, 1],
  () => [-0.001, 1000, -7],
];

function noeud(profondeur) {
  const n = new THREE.Object3D();
  n.position.set(dans(40), dans(40), dans(40));
  n.rotation.set(dans(Math.PI), dans(Math.PI), dans(Math.PI));
  n.scale.fromArray(ECHELLES[(profondeur + Math.floor(alea() * 7)) % ECHELLES.length]());
  return n;
}

const racine = new THREE.Object3D(),
  noeuds = [];
/** Chaînes de profondeur 1 à 6 sous la racine. */
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
/** Une branche à plusieurs enfants, dont un parent tourné à échelle non uniforme : cisaillement. */
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

/** Caméras posées dans la hiérarchie, sous des parents de toutes échelles. */
const cameras = [];
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

/** La matrice monde de chaque nœud, telle que Three.js la compose. */
export const mondesHierarchiques = noeuds.map((n) => n.matrixWorld.toArray());

/** Chaque nœud contre quelques boîtes : ce que la transformation de boîte et la sphère reçoivent. */
export const boitesHierarchiques = mondesHierarchiques.flatMap((m, i) =>
  boites.filter((_, j) => j % 9 === i % 9).map((b) => [b, m]),
);

/** Vues-projections des caméras de la hiérarchie, et boîtes monde des nœuds, dont une autour de l'œil. */
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

/** Cônes sous les matrices monde de la hiérarchie : matrice normale de Three, œil d'une caméra. */
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
