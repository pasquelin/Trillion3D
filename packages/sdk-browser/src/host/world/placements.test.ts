// placements.ts: the world matrices the ENGINE holds for the drawn nodes. The pose is
// a VIEW on the engine transform tree's own world buffer — no host-library matrix, and nothing
// copied per pass — and its sixteen numbers are compared bit-for-bit (Object.is) to `matrixWorld`
// after the reference's `updateMatrixWorld(true)`, on a scene with parents, negative and
// non-uniform scales, and a node whose host set the matrix itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../graph/graph.fixture.ts';
import { EngineError } from '../../../../sdk-core/src/index.ts';
import { collectClusterPages } from '../../page/selection/selection.ts';
import { hostWorldPlacements } from './placements.ts';
import { blendFixture } from '../../page/selection/blend.fixture.ts';
import { assertBits } from '../../../../../tests/kit/assert/bits.ts';

/** A host scene that NOBODY has walked up: rotated root, parent with negative and non-uniform
 *  scale, leaf sheared by that scale, plus a node whose matrix is set. */
function scene() {
  const racine = new G.Group(),
    parent = new G.Group(),
    feuille = G.mesh(),
    pose = new G.Group();
  racine.position.set(3, -4, 5);
  racine.quaternion.copy(new G.Quaternion().setFromEuler(new G.Euler(0.4, 0.1, -0.2)));
  parent.scale.set(-2, 0.5, 3);
  parent.position.set(-0, 7, 0.25);
  feuille.position.set(1, 2, -3);
  feuille.quaternion.copy(new G.Quaternion().setFromEuler(new G.Euler(-0.3, 0.7, 0.9)));
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
    Array.from(new G.Matrix4().elements),
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
  const etranger = new G.Group();
  etranger.name = 'foreign';
  assert.throws(
    () => worlds.of(etranger),
    (erreur: unknown) => erreur instanceof EngineError && erreur.code === 'UNKNOWN_TRANSFORM_NODE',
  );
});

test("page records and cluster roots carry the engine's matrix, not the host's", () => {
  const fixture = blendFixture();
  const parent = new G.Group();
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

test('the pose is a view on the engine tree: a pass rewrites it without copying anything', () => {
  const { racine, parent, feuille } = scene();
  const worlds = hostWorldPlacements(racine);
  const monde = worlds.of(feuille);
  const vue = monde.elements;
  parent.position.set(-11, 2, 0.5);
  worlds.refresh();
  assert.equal(monde.elements, vue, 'the same storage, never a second buffer');
  racine.updateMatrixWorld(true);
  assertBits(Array.from(vue), Array.from(feuille.matrixWorld.elements));
});

test('a pass that moves nothing leaves every pose on the bits it already carried', () => {
  const { racine, feuille, pose } = scene();
  const worlds = hostWorldPlacements(racine);
  const held = [feuille, pose].map((node) => Array.from(worlds.of(node).elements));
  worlds.refresh();
  for (const [rang, node] of [feuille, pose].entries())
    assertBits(Array.from(worlds.of(node).elements), held[rang]);
});
