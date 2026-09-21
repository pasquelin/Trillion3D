// hostWorldMatrices.ts: READ boundary of the host graph. Two subjects here — a node's local pose,
// read by the engine and compared bit-exact (Object.is) to Three's `updateMatrix` on hostile poses
// (negative, non-uniform, zero scales, `-0`, half-turn, matrix set by hand), and refusal of a
// non-finite pose. Update of the HOST scene remains compared to `updateMatrixWorld(true)`: it
// still serves its own readers.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EngineError } from '../sdk-core/index.ts';
import { assertFiniteTransform, hostLocalInto, resolveHostSubtree } from './hostWorldMatrices.ts';
import { assertBits } from '../sdk-core/bench/oracles/volumes.ts';

/** Parent → child → grandchild → great-grandchild chain, hostile transforms included. */
function hostileHierarchy() {
  const racine = new THREE.Group();
  racine.position.set(1, -2, 3);
  racine.scale.set(-1, 2, 0.5); // negative and non-uniform scale
  const enfant = new THREE.Group();
  enfant.matrixAutoUpdate = false;
  // Matrix set by hand, column-major: x shear along y, zero scale on z.
  enfant.matrix.set(1, 0.7, 0, 5, 0, 1, 0, -Infinity, 0, 0, 0, 0, 0, 0, 0, 1);
  racine.add(enfant);
  const petitEnfant = new THREE.Group();
  petitEnfant.position.set(NaN, 0, -0);
  enfant.add(petitEnfant);
  const feuille = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  feuille.position.set(2, 2, 2);
  petitEnfant.add(feuille);
  return { racine, enfant, petitEnfant, feuille };
}

test('resolveHostSubtree yields the same world matrices as updateMatrixWorld(true), hostile subtree included', () => {
  const obtenu = hostileHierarchy();
  const attendu = hostileHierarchy();
  resolveHostSubtree(obtenu.racine);
  attendu.racine.updateMatrixWorld(true);
  for (const clef of ['racine', 'enfant', 'petitEnfant', 'feuille'] as const)
    assertBits(obtenu[clef].matrixWorld.elements, attendu[clef].matrixWorld.elements);
});

test('resolveHostSubtree is idempotent: a second call changes no bit', () => {
  const { racine, feuille } = hostileHierarchy();
  resolveHostSubtree(racine);
  const premier = feuille.matrixWorld.elements.slice();
  resolveHostSubtree(racine);
  assertBits(feuille.matrixWorld.elements, premier);
});

test('resolveHostSubtree always forces recompute (force: true): a local matrix rewritten by hand, without updateMatrix, is still taken', () => {
  const parent = new THREE.Group();
  parent.matrixAutoUpdate = false; // the host sets its own local matrix
  const enfant = new THREE.Group();
  parent.add(enfant);
  resolveHostSubtree(parent); // first resolution: matrixWorld = identity for both
  // The host rewrites the local matrix directly: nothing marks the node dirty.
  parent.matrix.elements[12] = 7;
  resolveHostSubtree(parent);
  const attendu = new THREE.Matrix4();
  attendu.elements[12] = 7;
  assertBits(parent.matrixWorld.elements, attendu.elements);
  // The child inherits the recomputed parent.
  assertBits(enfant.matrixWorld.elements, attendu.elements);
});

test('resolveHostSubtree does not walk parents: a stale ancestor is not recomputed, and the child inherits it as-is, like updateMatrixWorld(true) called directly on the child', () => {
  const { racine, enfant } = hostileHierarchy();
  racine.updateMatrixWorld(true); // root matrixWorld set a first time
  // The root becomes stale without being updated: its position changes, matrixWorld stays the
  // old value until something recomputes it.
  racine.position.set(100, 100, 100);
  const perimee = racine.matrixWorld.elements.slice();
  resolveHostSubtree(enfant);
  const ref = hostileHierarchy();
  ref.racine.updateMatrixWorld(true);
  ref.racine.position.set(100, 100, 100);
  ref.enfant.updateMatrixWorld(true);
  // The root must not be recomputed.
  assertBits(racine.matrixWorld.elements, perimee);
  assertBits(racine.matrixWorld.elements, ref.racine.matrixWorld.elements);
  assertBits(enfant.matrixWorld.elements, ref.enfant.matrixWorld.elements);
});

/** Poses the reference composes: negative, zero, `-0`, half-turn, non-uniform scales. */
const POSES: [number[], number[], number[]][] = [
  [
    [0, 0, 0],
    [0, 0, 0, 1],
    [1, 1, 1],
  ],
  [
    [-0, -0, -0],
    [0, 1, 0, 0],
    [-1, 2, 0.5],
  ],
  [
    [3, -4, 5],
    [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    [0, 1, 1],
  ],
  [
    [1e150, -1e150, 1e-300],
    [0.5, 0.5, 0.5, 0.5],
    [-2, 3, 0.25],
  ],
  [
    [10, 20, 30],
    [0, 0, 0, 1],
    [1e-300, 1, -1],
  ],
];

test('hostLocalInto yields updateMatrix’s local matrix, bit-exact, on hostile poses', () => {
  const obtenu = new Float64Array(16);
  for (const [position, quaternion, echelle] of POSES) {
    const node = new THREE.Object3D();
    node.position.fromArray(position);
    node.quaternion.fromArray(quaternion);
    node.scale.fromArray(echelle);
    hostLocalInto(obtenu, node);
    node.updateMatrix(); // the reference composes the SAME pose
    assertBits(obtenu, node.matrix.elements);
  }
});

test('hostLocalInto yields the SET matrix when the host cut recomposition, without ever recomposing it', () => {
  const node = new THREE.Object3D();
  node.matrixAutoUpdate = false;
  // A shear: no translation-rotation-scale pose yields it, so recomposing would show.
  node.matrix.set(1, 0.7, 0, 5, 0, 1, 0, -3, 0, 0, 0, 0, 0, 0, 0, 1);
  node.position.set(100, 100, 100); // pose contradicting the matrix: it must not be read
  const obtenu = new Float64Array(16);
  hostLocalInto(obtenu, node);
  assertBits(obtenu, node.matrix.elements);
});

test('hostLocalInto writes nothing into the host node: its local matrix stays the one it carried', () => {
  const node = new THREE.Object3D();
  node.position.set(1, 2, 3);
  const avant = node.matrix.elements.slice(); // identity: `updateMatrix` has never been called
  hostLocalInto(new Float64Array(16), node);
  assertBits(node.matrix.elements, avant);
});

// Case 4 of the singular-normal convention (singular-normals batch): a non-finite pose never
// enters the engine, it is refused right here, before any inversion or any normal read.
test('assertFiniteTransform: a fully finite matrix passes without throwing', () => {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(1, -2, 3),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.5, 0.2)),
    new THREE.Vector3(-2, 3, 0.5),
  ).elements;
  assert.doesNotThrow(() => assertFiniteTransform(m, 'noeud'));
});

test('assertFiniteTransform: NaN at any of the sixteen indices throws NON_FINITE_TRANSFORM with the node name and the faulty rank', () => {
  for (let index = 0; index < 16; index++) {
    const m = new THREE.Matrix4().identity().elements.slice();
    m[index] = NaN;
    assert.throws(
      () => assertFiniteTransform(m, 'cible'),
      (erreur: unknown) =>
        erreur instanceof EngineError &&
        erreur.code === 'NON_FINITE_TRANSFORM' &&
        erreur.details.nodeName === 'cible' &&
        erreur.details.index === index &&
        Number.isNaN(erreur.details.value as number),
      `index ${index}: NaN not refused`,
    );
  }
});

test('assertFiniteTransform: an infinity, positive or negative, throws NON_FINITE_TRANSFORM', () => {
  for (const valeur of [Infinity, -Infinity]) {
    const m = new THREE.Matrix4().identity().elements.slice();
    m[5] = valeur;
    assert.throws(
      () => assertFiniteTransform(m, 'lampe'),
      (erreur: unknown) =>
        erreur instanceof EngineError &&
        erreur.code === 'NON_FINITE_TRANSFORM' &&
        erreur.details.index === 5 &&
        erreur.details.value === valeur,
      `${valeur} not refused`,
    );
  }
});
