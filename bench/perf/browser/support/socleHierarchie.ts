// Parent/child hierarchies of the foundation bench: real `Object3D` of the reference, updated
// by `updateMatrixWorld(true)`, and their mirror held by the foundation — local TRS composition,
// then parent × local in the reference order. Both sides read the same position, quaternion
// and scale, node by node.
import * as THREE from 'three';
import {
  composeMatrix4,
  determinantMatrix4,
  invertMatrix4,
  multiplyMatrix4,
  normalMatrix3,
} from '../../../../packages/sdk-core/index.ts';
import { graine } from '../../../core/index.ts';
import { f64, normaleReference, trs } from './socleLigne.ts';

/** A node on both sides: the reference object and the foundation buffers. */
export interface HierarchyNode {
  objet: THREE.Object3D;
  position: Float64Array;
  rotation: Float64Array;
  echelle: Float64Array;
  local: Float64Array;
  monde: Float64Array;
  parent: number;
}

/** A node on both sides: the reference object and the foundation buffers. */
function noeud(p: ArrayLike<number>, q: ArrayLike<number>, s: ArrayLike<number>): HierarchyNode {
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

/** Attaches `enfant` to `parent` on both sides; indices grow from parents toward children. */
function relie(noeuds: HierarchyNode[], enfant: number, parent: number) {
  noeuds[parent].objet.add(noeuds[enfant].objet);
  noeuds[enfant].parent = parent;
}

/** The foundation update, in index order: a parent is always up to date before its children. */
function metAJour(noeuds: HierarchyNode[]) {
  for (let i = 0; i < noeuds.length; i++) {
    const n = noeuds[i];
    composeMatrix4(n.local, n.position, n.rotation, n.echelle);
    if (n.parent < 0) n.monde.set(n.local);
    else multiplyMatrix4(n.monde, noeuds[n.parent].monde, n.local);
  }
}

/** Hostile scales: negative on one axis or three, non-uniform, zero, extremes. */
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
/** Rotations: identity, arbitrary, half-turn (`w = 0`), tiny angle. */
const ROTATIONS = [
  [0, 0, 0, 1],
  tourne(),
  tourne(),
  [0, 1, 0, 0],
  [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 1, 0).normalize(), 1e-9).toArray(),
  tourne(),
];
/** Positions: origin, negative zeros, ordinary, extremes. */
const POSITIONS = [
  [0, 0, 0],
  [-0, -0, -0],
  [3, -4, 5],
  [1e150, -1e150, 1e-300],
  [alea() * 1000, alea() * 1000, alea() * 1000],
];

/**
 * Hostile chains: depths 1 to 6, each level drawing its scale, rotation and
 * position from the lists above, then a branch of five children each carrying a chain of
 * three. A non-uniform scale under a parent rotation shears the world matrix.
 */
export function chainesHostiles(): HierarchyNode[] {
  const noeuds: HierarchyNode[] = [],
    racines: THREE.Object3D[] = [];
  const ajoute = (niveau: number, k: number, parent: number) => {
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

/** What the reference yields of an updated node, and what the foundation yields of its mirror. */
export function lectureReference(n: HierarchyNode) {
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
export function lectureSocle(n: HierarchyNode) {
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
