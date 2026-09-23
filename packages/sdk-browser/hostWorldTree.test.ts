// hostWorldTree.ts: world matrices of a subtree, computed by THE ENGINE from the host's local
// poses, compared bit-exact (Object.is) to `node.matrixWorld` after the reference's
// `updateMatrixWorld(true)` — on a real host-library scene with parents, negative and non-uniform
// scales, `-0`, half-turns and a node whose host set the matrix itself. Both paths are tried:
// the hierarchy batch and the core tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { EngineError, MATRIX_VALUES } from '../sdk-core/index.ts';
import { prepareSdkWasm } from './geometryPageWasm.ts';
import { prepareMathBatch } from './mathBatchState.ts';
import { hostWorldLot, hostWorldTree } from './hostWorldTree.ts';
import { assertBits } from '../../tests/kit/assert/bits.ts';

await prepareSdkWasm(readFileSync(join(import.meta.dirname, 'pageCodec.wasm')));

/** Hostile scales, rotations and positions, drawn in turn by the construction. */
const ECHELLES = [
  [1, 1, 1],
  [-1, 2, 0.5],
  [2, -3, 0.25],
  [1, 1, -1],
  [0.5, 0.5, 0.5],
];
const ROTATIONS = [
  [0, 0, 0, 1],
  [0, 1, 0, 0],
  [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  [0.5, 0.5, 0.5, 0.5],
];
const POSITIONS = [
  [0, 0, 0],
  [-0, -0, -0],
  [3, -4, 5],
  [0.25, -0.5, 7],
];

/**
 * A host scene: one root, three levels, five children per first-level node. Each node draws its
 * pose from the lists above; a non-uniform scale under a parent rotation shears the world matrix.
 */
function scene(pose?: (node: THREE.Object3D, rang: number) => void) {
  const nodes: THREE.Object3D[] = [];
  const ajoute = (parent: THREE.Object3D | null) => {
    const node = new THREE.Group();
    const rang = nodes.length;
    node.name = `n${rang}`;
    node.position.fromArray(POSITIONS[rang % POSITIONS.length]);
    node.quaternion.fromArray(ROTATIONS[rang % ROTATIONS.length]);
    node.scale.fromArray(ECHELLES[rang % ECHELLES.length]);
    pose?.(node, rang);
    parent?.add(node);
    nodes.push(node);
    return node;
  };
  const racine = ajoute(null);
  for (let branche = 0; branche < 5; branche++) {
    const premier = ajoute(racine);
    for (let enfant = 0; enfant < 5; enfant++) ajoute(ajoute(premier));
  }
  return { racine, nodes };
}

/** Each node compared to what the reference composed for it. */
function compare(
  nodes: readonly THREE.Object3D[],
  mondes: { world(n: THREE.Object3D): Float64Array },
) {
  for (const node of nodes) assertBits(mondes.world(node), node.matrixWorld.elements);
}

test('engine world matrices are the reference’s, bit-exact, via the hierarchy BATCH', async () => {
  await prepareMathBatch('wasm');
  const { racine, nodes } = scene();
  const lot = await hostWorldLot(racine);
  assert.ok(lot);
  const mondes = hostWorldTree(racine, lot);
  assert.equal(mondes.n, nodes.length, 'the whole subtree is indexed');
  assert.equal(mondes.batched, true, 'a subtree that recomposes goes to the batch');
  // The reference composes AFTER the engine: nothing it writes could have served as input.
  racine.updateMatrixWorld(true);
  compare(nodes, mondes);
  lot.release();
});

test('the batch JavaScript path yields the same bits as the WebAssembly path', async () => {
  const { racine, nodes } = scene();
  const lot = await hostWorldLot(racine);
  assert.ok(lot);
  await prepareMathBatch('js');
  const mondes = hostWorldTree(racine, lot);
  assert.equal(mondes.batched, true);
  racine.updateMatrixWorld(true);
  compare(nodes, mondes);
  lot.release();
});

test('a node whose host set the matrix itself goes through the core tree, at the same bits', async () => {
  await prepareMathBatch('wasm');
  const { racine, nodes } = scene((node, rang) => {
    if (rang !== 7) return;
    node.matrixAutoUpdate = false;
    // A shear: no translation-rotation-scale pose yields it.
    node.matrix.set(1, 0.7, 0, 5, 0, 1, 0, -2, 0, 0, 3, 0, 0, 0, 0, 1);
  });
  const lot = await hostWorldLot(racine);
  assert.ok(lot);
  const mondes = hostWorldTree(racine, lot);
  assert.equal(mondes.batched, false, 'the batch cannot receive a set matrix');
  racine.updateMatrixWorld(true);
  compare(nodes, mondes);
  lot.release();
});

test('without the batch, the core tree yields the same bits as the reference', () => {
  const { racine, nodes } = scene();
  const mondes = hostWorldTree(racine);
  assert.equal(mondes.batched, false);
  racine.updateMatrixWorld(true);
  compare(nodes, mondes);
});

test('the engine never writes `matrixWorld` on the host', () => {
  const { racine, nodes } = scene();
  const mondes = hostWorldTree(racine);
  const identite = new THREE.Matrix4().elements;
  for (const node of nodes) assertBits(node.matrixWorld.elements, identite);
  // And what the engine holds is not identity: the comparison is not empty.
  assert.notEqual(mondes.world(nodes[3])[12], 0);
});

test('the index covers ancestors of the subtree root: the engine does not start from a stale parent', () => {
  const { racine, nodes } = scene();
  const grandParent = new THREE.Group();
  grandParent.position.set(9, -9, 9);
  grandParent.scale.set(-2, 1, 1);
  const parent = new THREE.Group();
  parent.quaternion.set(0, 1, 0, 0);
  grandParent.add(parent);
  parent.add(racine);
  const mondes = hostWorldTree(racine);
  assert.equal(mondes.n, nodes.length + 2, 'both ancestors are indexed');
  grandParent.updateMatrixWorld(true);
  compare([grandParent, parent, ...nodes], mondes);
});

test('`refresh` takes a pose the host has just written, on both paths', async () => {
  await prepareMathBatch('wasm');
  const { racine, nodes } = scene();
  const lot = await hostWorldLot(racine);
  assert.ok(lot);
  const mondes = hostWorldTree(racine, lot);
  nodes[2].position.set(42, -42, 42);
  mondes.refresh();
  racine.updateMatrixWorld(true);
  compare(nodes, mondes);
  lot.release();
});

test('batch views survive a growth of the module memory', async () => {
  await prepareMathBatch('wasm');
  const { racine, nodes } = scene();
  const lot = await hostWorldLot(racine);
  assert.ok(lot);
  const mondes = hostWorldTree(racine, lot);
  const avant = mondes.world(nodes[9]).slice();
  const wasm = await prepareSdkWasm();
  assert.ok(wasm);
  const gros = wasm.arena_alloc(64 * 1024 * 1024);
  assert.ok(gros, 'the large reservation must succeed');
  const apres = mondes.world(nodes[9]);
  assert.equal(apres.length, MATRIX_VALUES);
  assertBits(apres, avant);
  wasm.arena_free(gros, 64 * 1024 * 1024);
  lot.release();
});

test('a node outside the index is refused, it does not yield a neutral pose', () => {
  const { racine } = scene();
  const etranger = new THREE.Group();
  etranger.name = 'etranger';
  assert.throws(
    () => hostWorldTree(racine).world(etranger),
    (erreur: unknown) =>
      erreur instanceof EngineError &&
      erreur.code === 'UNKNOWN_TRANSFORM_NODE' &&
      erreur.details.nodeName === 'etranger',
  );
});
