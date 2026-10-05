// placements.ts: the world matrices of the drawn nodes, read where they live — the transform tree
// every node is a slot of. A pose is its node's own world matrix there, rewritten in place by the
// tree's pass, never copied, kept through the tree's growth; its sixteen numbers are compared
// bit-for-bit (Object.is) to those composed from the local poses of its chain (`chainWorld`), on a
// scene with parents, negative and non-uniform scales, and a node whose matrix is set by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../graph/graph.fixture.ts';
import { collectClusterPages } from '../../page/selection/selection.ts';
import { hostWorldPlacements } from './placements.ts';
import { blendFixture } from '../../page/selection/blend.fixture.ts';
import { assertBits } from '../../../../../tests/kit/assert/bits.ts';
import { chainWorld } from '../../../../../tests/kit/assert/chainWorld.ts';
import { rootOf } from '../../page/selection/placements.ts';

/** A scene nobody has walked up: rotated root, parent with negative and non-uniform scale, leaf
 *  sheared by that scale, plus a node whose matrix is set. */
function scene() {
  const root = new G.Group(),
    parent = new G.Group(),
    leaf = G.mesh(),
    posed = new G.Group();
  root.position.set(3, -4, 5);
  root.quaternion.copy(new G.Quaternion().setFromEuler(new G.Euler(0.4, 0.1, -0.2)));
  parent.scale.set(-2, 0.5, 3);
  parent.position.set(-0, 7, 0.25);
  leaf.position.set(1, 2, -3);
  leaf.quaternion.copy(new G.Quaternion().setFromEuler(new G.Euler(-0.3, 0.7, 0.9)));
  leaf.scale.set(1, 1, -1);
  posed.matrixAutoUpdate = false;
  posed.matrix.set(1, 3, 0, 2, 0, 1, 0, -1, 0, 0, 1, 4, 0, 0, 0, 1);
  parent.add(leaf, posed);
  root.add(parent);
  return { root, parent, leaf, posed };
}

test('the returned matrix carries, to the bit, the world its chain composes from its poses', () => {
  const { root, parent, leaf, posed } = scene();
  const worlds = hostWorldPlacements(root);
  for (const node of [parent, leaf, posed])
    assertBits(worlds.of(node).elements, chainWorld(node), node.name);
});

test('`refresh` rewrites the returned matrix in place: the holder sees the move', () => {
  const { root, parent, leaf } = scene();
  const worlds = hostWorldPlacements(root);
  const world = worlds.of(leaf),
    view = world.elements;
  parent.position.set(10, -8, 6);
  worlds.refresh();
  assert.equal(worlds.of(leaf), world, 'the same pose, never a second one');
  assert.equal(world.elements, view, 'the same storage, never a second buffer');
  assertBits(view, chainWorld(leaf));
});

test("a pose is its node's own world storage, and stays it while the tree grows", () => {
  const { root, parent, leaf } = scene();
  const worlds = hostWorldPlacements(root);
  const view = worlds.of(leaf).elements;
  assert.equal(view, leaf.matrixWorld.elements, 'one storage for the node and the engine');
  for (let i = 0; i < 300; i++) new G.Group();
  parent.position.set(1, 1, 1);
  worlds.refresh();
  assert.equal(worlds.of(leaf).elements, view);
  assertBits(view, chainWorld(leaf));
});

test('a pass that moves nothing leaves every pose on the bits it carried', () => {
  const { root, leaf, posed } = scene();
  const worlds = hostWorldPlacements(root);
  const held = [leaf, posed].map((node) => Array.from(worlds.of(node).elements));
  worlds.refresh();
  for (const [rank, node] of [leaf, posed].entries())
    assertBits(worlds.of(node).elements, held[rank]);
});

test('page records and cluster roots carry the tree world of their mesh', () => {
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
  const world = worlds.of(fixture.mesh);
  assert.equal(roots[0].world, world, 'the root carries the pose');
  assert.ok(allPages.length > 0, 'the collection read pages');
  for (let rank = 0; rank < roots.length; rank++)
    assert.equal(rootOf(roots, rank).world, world, 'every placement reads it');
  assert.equal(world.elements, fixture.mesh.matrixWorld.elements, "the mesh's own world storage");
  fixture.geometry.dispose();
  fixture.material.dispose();
});
