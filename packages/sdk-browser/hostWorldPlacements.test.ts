// hostWorldPlacements.ts: the world matrices the ENGINE holds for the drawn nodes. The container
// is a host-library matrix — what the host attaches and what witnesses draw — but its sixteen
// numbers come from the core: they are compared bit-for-bit (Object.is) to `matrixWorld` after
// the reference's `updateMatrixWorld(true)`, on a scene with parents, negative and non-uniform
// scales, and a node whose host set the matrix itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EngineError } from '../sdk-core/index.ts';
import { collectClusterPages } from './pageSelection.ts';
import { hostWorldPlacements } from './hostWorldPlacements.ts';
import { blendFixture } from './pageSelectionBlendFixture.ts';
import { assertBits } from '../sdk-core/bench/oracles/volumes.mjs';

/** A host scene that NOBODY has walked up: rotated root, parent with negative and non-uniform
 *  scale, leaf sheared by that scale, plus a node whose matrix is set. */
function scene() {
  const racine = new THREE.Group(),
    parent = new THREE.Group(),
    feuille = new THREE.Mesh(),
    pose = new THREE.Group();
  racine.position.set(3, -4, 5);
  racine.quaternion.setFromEuler(new THREE.Euler(0.4, 0.1, -0.2));
  parent.scale.set(-2, 0.5, 3);
  parent.position.set(-0, 7, 0.25);
  feuille.position.set(1, 2, -3);
  feuille.quaternion.setFromEuler(new THREE.Euler(-0.3, 0.7, 0.9));
  feuille.scale.set(1, 1, -1);
  pose.matrixAutoUpdate = false;
  pose.matrix.set(1, 3, 0, 2, 0, 1, 0, -1, 0, 0, 1, 4, 0, 0, 0, 1);
  parent.add(feuille, pose);
  racine.add(parent);
  return { racine, parent, feuille, pose };
}

test('the returned matrix carries, to the bit, the world the reference composes from the same poses', () => {
  const { racine, parent, feuille, pose } = scene();
  const worlds = hostWorldPlacements(racine);
  const obtenus = [parent, feuille, pose].map((node) => Array.from(worlds.of(node).elements));
  // The witness runs AFTER: until it has walked the graph, the host has composed no matrix.
  racine.updateMatrixWorld(true);
  for (const [rang, node] of [parent, feuille, pose].entries())
    assertBits(obtenus[rang], Array.from(node.matrixWorld.elements));
});

test("the host's world matrix is neither read nor written: it stays the identity it left", () => {
  const { racine, feuille } = scene();
  const worlds = hostWorldPlacements(racine);
  const monde = worlds.of(feuille);
  worlds.refresh();
  assert.deepEqual(
    Array.from(feuille.matrixWorld.elements),
    Array.from(new THREE.Matrix4().elements),
    'the engine wrote nothing into the host scene',
  );
  assert.notDeepEqual(
    Array.from(monde.elements),
    Array.from(feuille.matrixWorld.elements),
    'and what it holds is not what the host carries',
  );
});

test('`refresh` rewrites the returned matrix instead of returning another: the holder sees the move', () => {
  const { racine, parent, feuille } = scene();
  const worlds = hostWorldPlacements(racine);
  const monde = worlds.of(feuille);
  const avant = Array.from(monde.elements);
  parent.position.set(10, -8, 6);
  worlds.refresh();
  assert.equal(worlds.of(feuille), monde, 'the same matrix, never a second one');
  assert.notDeepEqual(Array.from(monde.elements), avant, 'the moved parent is in the world');
  racine.updateMatrixWorld(true);
  assertBits(Array.from(monde.elements), Array.from(feuille.matrixWorld.elements));
});

test('a node outside the indexed subtree is refused by a named error', () => {
  const { racine } = scene();
  const worlds = hostWorldPlacements(racine);
  const etranger = new THREE.Group();
  etranger.name = 'foreign';
  assert.throws(
    () => worlds.of(etranger),
    (erreur: unknown) => erreur instanceof EngineError && erreur.code === 'UNKNOWN_TRANSFORM_NODE',
  );
});

test("page records and cluster roots carry the engine's matrix, not the host's", () => {
  const fixture = blendFixture();
  const parent = new THREE.Group();
  parent.scale.set(2, -1, 0.5);
  parent.add(fixture.source);
  fixture.mesh.position.set(4, -2, 7);
  const { roots, allPages, worlds } = collectClusterPages(
    parent,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const monde = worlds.of(fixture.mesh);
  assert.equal(roots[0].world, monde, 'the root carries the engine matrix');
  for (const page of allPages) assert.equal(page.matrix, monde, 'the record carries the same');
  assert.notEqual(monde, fixture.mesh.matrixWorld, "it is not the host's live matrix");
  // The witness runs after: collection never asked the host to compose anything.
  parent.updateMatrixWorld(true);
  assertBits(Array.from(monde.elements), Array.from(fixture.mesh.matrixWorld.elements));
  fixture.geometry.dispose();
  fixture.material.dispose();
});
