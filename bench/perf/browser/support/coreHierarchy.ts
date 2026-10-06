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
} from '../../../../packages/sdk-core/src/index.ts';
import { xorshiftRandom } from '../../../core/index.ts';
import { f64, referenceNormal, trs } from './coreLine.ts';

/** A node on both sides: the reference object and the foundation buffers. */
export interface HierarchyNode {
  object: THREE.Object3D;
  position: Float64Array;
  rotation: Float64Array;
  scale: Float64Array;
  local: Float64Array;
  world: Float64Array;
  parent: number;
}

/** A node on both sides: the reference object and the foundation buffers. */
function node(p: ArrayLike<number>, q: ArrayLike<number>, s: ArrayLike<number>): HierarchyNode {
  const object = new THREE.Object3D();
  object.position.fromArray(p);
  object.quaternion.fromArray(q);
  object.scale.fromArray(s);
  return {
    object,
    position: Float64Array.from(p),
    rotation: Float64Array.from(q),
    scale: Float64Array.from(s),
    local: new Float64Array(16),
    world: new Float64Array(16),
    parent: -1,
  };
}

/** Attaches `child` to `parent` on both sides; indices grow from parents toward children. */
function relie(nodes: HierarchyNode[], child: number, parent: number) {
  nodes[parent].object.add(nodes[child].object);
  nodes[child].parent = parent;
}

/** The foundation update, in index order: a parent is always up to date before its children. */
function metAJour(nodes: HierarchyNode[]) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    composeMatrix4(n.local, n.position, n.rotation, n.scale);
    if (n.parent < 0) n.world.set(n.local);
    else multiplyMatrix4(n.world, nodes[n.parent].world, n.local);
  }
}

/** Hostile scales: negative on one axis or three, non-uniform, zero, extremes. */
const SCALES = [
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
const alea = xorshiftRandom(0x41e7);
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
  const nodes: HierarchyNode[] = [],
    roots: THREE.Object3D[] = [];
  const add = (level: number, k: number, parent: number) => {
    const i = nodes.length;
    nodes.push(
      node(
        POSITIONS[(k + level) % POSITIONS.length],
        ROTATIONS[(k * 3 + level) % ROTATIONS.length],
        SCALES[(k * 7 + level * 5) % SCALES.length],
      ),
    );
    if (parent >= 0) relie(nodes, i, parent);
    else roots.push(nodes[i].object);
    return i;
  };
  for (let k = 0; k < 84; k++) {
    let parent = -1;
    for (let level = 0; level <= k % 6; level++) parent = add(level, k, parent);
  }
  for (let k = 0; k < 12; k++) {
    const branche = add(0, k, -1);
    for (let child = 0; child < 5; child++) {
      let parent = branche;
      for (let level = 1; level <= 3; level++) parent = add(level, k + child, parent);
    }
  }
  for (const root of roots) root.updateMatrixWorld(true);
  metAJour(nodes);
  return nodes;
}

/** What the reference yields of an updated node, and what the foundation yields of its mirror. */
export function lectureReference(n: HierarchyNode) {
  const o = n.object;
  return [
    f64(o.matrixWorld.elements),
    f64(o.getWorldPosition(new THREE.Vector3()).toArray()),
    f64(o.getWorldQuaternion(new THREE.Quaternion()).toArray()),
    f64(o.getWorldScale(new THREE.Vector3()).toArray()),
    o.matrixWorld.determinant(),
    Math.sign(o.matrixWorld.determinant()),
    referenceNormal(o.matrixWorld),
    f64(o.matrixWorld.clone().invert().elements),
  ];
}
export function lectureSocle(n: HierarchyNode) {
  const w = n.world,
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
