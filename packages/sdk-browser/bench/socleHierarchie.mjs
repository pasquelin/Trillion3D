// Les hiérarchies parent/enfant du banc du socle : de vrais `Object3D` de la référence, mis à jour par
// `updateMatrixWorld(true)`, et leur miroir tenu par le socle — composition TRS locale, puis produit
// parent × local dans l'ordre de la référence. Les deux côtés lisent les mêmes position, quaternion et
// échelle, nœud par nœud.
import * as THREE from 'three';
import {
  composeMatrix4,
  determinantMatrix4,
  invertMatrix4,
  multiplyMatrix4,
  normalMatrix3,
} from '../../sdk-core/index.ts';
import { graine } from '../../sdk-core/bench/mesure.mjs';
import { f64, normaleReference, trs } from './socleLigne.mjs';

/** Un nœud des deux côtés : l'objet de la référence et les tampons du socle. */
function noeud(p, q, s) {
  const objet = new THREE.Object3D();
  objet.position.fromArray(p);
  objet.quaternion.fromArray(q);
  objet.scale.fromArray(s);
  return {
    objet,
    position: Float64Array.from(p),
    rotation: Float64Array.from(q),
    echelle: Float64Array.from(s),
    local: new Float64Array(16),
    monde: new Float64Array(16),
    parent: -1,
  };
}

/** Rattache `enfant` à `parent` des deux côtés ; les indices croissent des parents vers les enfants. */
function relie(noeuds, enfant, parent) {
  noeuds[parent].objet.add(noeuds[enfant].objet);
  noeuds[enfant].parent = parent;
}

/** La mise à jour du socle, dans l'ordre des indices : un parent est toujours à jour avant ses enfants. */
function metAJour(noeuds) {
  for (let i = 0; i < noeuds.length; i++) {
    const n = noeuds[i];
    composeMatrix4(n.local, n.position, n.rotation, n.echelle);
    if (n.parent < 0) n.monde.set(n.local);
    else multiplyMatrix4(n.monde, noeuds[n.parent].monde, n.local);
  }
}

/** Une scène ordinaire du moteur : `taille` nœuds, parent tiré parmi les précédents, échelles positives. */
export function hierarchie(taille, depart) {
  const alea = graine(depart),
    noeuds = [];
  for (let i = 0; i < taille; i++) {
    const q = new THREE.Quaternion(alea() - 0.5, alea() - 0.5, alea() - 0.5, alea() - 0.5);
    noeuds.push(
      noeud([alea() * 10, alea() * 10, alea() * 10], q.normalize().toArray(), [
        0.5 + alea(),
        0.5 + alea(),
        0.5 + alea(),
      ]),
    );
    if (i) relie(noeuds, i, Math.floor(alea() * i));
  }
  return { racine: noeuds[0].objet, noeuds, metAJourSocle: () => metAJour(noeuds) };
}

/** Échelles hostiles : négatives sur un axe ou trois, non uniformes, nulle, extrêmes. */
const ECHELLES = [
  [1, 1, 1],
  [-1, 1, 1],
  [1, -1, 1],
  [1, 1, -1],
  [-1, -1, -1],
  [2, 0.5, 3],
  [-2, 3, 0.25],
  [0, 1, 1],
  [1e-300, 1, 1],
  [1e150, 1e150, 1e150],
  [1, 1e-8, 1],
  [7, 7, 7],
];
const alea = graine(0x41e7);
const tourne = () =>
  new THREE.Quaternion(alea() - 0.5, alea() - 0.5, alea() - 0.5, alea() - 0.5)
    .normalize()
    .toArray();
/** Rotations : identité, quelconques, demi-tour (`w = 0`), angle minuscule. */
const ROTATIONS = [
  [0, 0, 0, 1],
  tourne(),
  tourne(),
  [0, 1, 0, 0],
  [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 1, 0).normalize(), 1e-9).toArray(),
  tourne(),
];
/** Positions : origine, zéros négatifs, ordinaires, extrêmes. */
const POSITIONS = [
  [0, 0, 0],
  [-0, -0, -0],
  [3, -4, 5],
  [1e150, -1e150, 1e-300],
  [alea() * 1000, alea() * 1000, alea() * 1000],
];

/**
 * Les chaînes hostiles : profondeurs 1 à 6, chaque niveau tirant son échelle, sa rotation et sa
 * position dans les listes ci-dessus, puis une branche à cinq enfants portant chacun une chaîne de
 * trois. Une échelle non uniforme sous une rotation parente cisaille la matrice monde.
 */
export function chainesHostiles() {
  const noeuds = [],
    racines = [];
  const ajoute = (niveau, k, parent) => {
    const i = noeuds.length;
    noeuds.push(
      noeud(
        POSITIONS[(k + niveau) % POSITIONS.length],
        ROTATIONS[(k * 3 + niveau) % ROTATIONS.length],
        ECHELLES[(k * 7 + niveau * 5) % ECHELLES.length],
      ),
    );
    if (parent >= 0) relie(noeuds, i, parent);
    else racines.push(noeuds[i].objet);
    return i;
  };
  for (let k = 0; k < 84; k++) {
    let parent = -1;
    for (let niveau = 0; niveau <= k % 6; niveau++) parent = ajoute(niveau, k, parent);
  }
  for (let k = 0; k < 12; k++) {
    const branche = ajoute(0, k, -1);
    for (let enfant = 0; enfant < 5; enfant++) {
      let parent = branche;
      for (let niveau = 1; niveau <= 3; niveau++) parent = ajoute(niveau, k + enfant, parent);
    }
  }
  for (const racine of racines) racine.updateMatrixWorld(true);
  metAJour(noeuds);
  return noeuds;
}

/** Ce que la référence rend d'un nœud mis à jour, et ce que le socle rend de son miroir. */
export function lectureReference(n) {
  const o = n.objet;
  return [
    f64(o.matrixWorld.elements),
    f64(o.getWorldPosition(new THREE.Vector3()).toArray()),
    f64(o.getWorldQuaternion(new THREE.Quaternion()).toArray()),
    f64(o.getWorldScale(new THREE.Vector3()).toArray()),
    o.matrixWorld.determinant(),
    Math.sign(o.matrixWorld.determinant()),
    normaleReference(o.matrixWorld),
    f64(o.matrixWorld.clone().invert().elements),
  ];
}
export function lectureSocle(n) {
  const w = n.monde,
    [, q, s] = trs(w);
  return [
    f64(w),
    f64([w[12], w[13], w[14]]),
    q,
    s,
    determinantMatrix4(w),
    Math.sign(determinantMatrix4(w)),
    normalMatrix3(new Float64Array(9), w),
    invertMatrix4(new Float64Array(16), w),
  ];
}
