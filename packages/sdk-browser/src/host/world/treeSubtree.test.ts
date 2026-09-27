// `refreshFrom` (tree.ts): the pass on one moved subtree yields, for EVERY node of the index, the
// bits of the whole pass `refresh` that a move ran before (#915) — on random trees whose poses mix
// NaN, the infinities, `-0`, null scales and sheared matrices set by the host.
import test from 'node:test';
import { hostWorldPlacements } from './placements.ts';
import { hostWorldTree } from './tree.ts';
import { drawPose, pick, randomTree, seeded, type Draw } from './randomTree.fixture.ts';
import { assertBits } from '../../../../../tests/kit/assert/bits.ts';
import * as G from '../graph/graph.fixture.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

/** Every node of `root`'s subtree, prefix order. */
function subtree(root: Object3D) {
  const out: Object3D[] = [];
  root.traverse((node) => out.push(node));
  return out;
}

/** New poses on a random share of `root`'s subtree: what a move, or a host between two moves
 *  inside that subtree, writes. `root` itself always moves. */
function moveSubtree(draw: Draw, root: Object3D, hostile: boolean) {
  drawPose(draw, root, hostile);
  for (const node of subtree(root))
    if (node !== root && draw() < 0.3) drawPose(draw, node, hostile);
}

for (const hostile of [false, true])
  test(`refreshFrom: the bits of the whole pass on every node, ${hostile ? 'hostile' : 'finite'} poses`, () => {
    for (let seed = 1; seed <= 40; seed++) {
      const draw = seeded(seed * 7919 + (hostile ? 1 : 0));
      const { top, source, nodes } = randomTree(draw, 5 + Math.floor(draw() * 60), 6, hostile);
      // The index a move now refreshes by subtree, and the one it refreshed whole.
      const moved = hostWorldPlacements(source),
        whole = hostWorldPlacements(source);
      const all = [...subtree(top)];
      for (let step = 0; step < 12; step++) {
        const node = pick(draw, nodes);
        moveSubtree(draw, node, hostile);
        moved.refreshFrom(node);
        whole.refresh();
        for (const each of all)
          assertBits(moved.of(each).elements, whole.of(each).elements, `seed ${seed} ${each.name}`);
      }
      // A fresh index, built from scratch on the same poses: the same bits again.
      const fresh = hostWorldPlacements(source);
      for (const each of all)
        assertBits(moved.of(each).elements, fresh.of(each).elements, `seed ${seed} fresh`);
    }
  });

test('refreshFrom: a node outside the index takes the whole pass', () => {
  const draw = seeded(3);
  const { source, nodes } = randomTree(draw, 20);
  const moved = hostWorldTree(source),
    whole = hostWorldTree(source);
  for (const node of nodes) drawPose(draw, node);
  moved.refreshFrom(new G.Group());
  whole.refresh();
  for (const node of nodes) assertBits(moved.world(node), whole.world(node), node.name);
});

test('refreshFrom: the root of the index, and a leaf, match the whole pass', () => {
  const draw = seeded(11);
  const { source, nodes } = randomTree(draw, 30);
  const moved = hostWorldTree(source),
    whole = hostWorldTree(source);
  const leaf = nodes.find((node) => node.children.length === 0)!;
  for (const node of [source, leaf]) {
    moveSubtree(draw, node, false);
    moved.refreshFrom(node);
    whole.refresh();
    for (const each of nodes) assertBits(moved.world(each), whole.world(each), each.name);
  }
});

test('refreshFrom: poses written anywhere — the subtree and its ancestors exact, the rest at the next pass', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const draw = seeded(seed * 613);
    const { top, source, nodes } = randomTree(draw, 10 + Math.floor(draw() * 50));
    const moved = hostWorldTree(source),
      whole = hostWorldTree(source);
    for (let step = 0; step < 10; step++) {
      for (let k = 0; k < 3; k++) drawPose(draw, pick(draw, nodes));
      const node = pick(draw, nodes);
      moved.refreshFrom(node);
      whole.refresh();
      const exact = subtree(node);
      for (let up = node.parent; up; up = up.parent) exact.push(up);
      for (const each of exact) assertBits(moved.world(each), whole.world(each), `seed ${seed}`);
    }
    moved.refresh();
    for (const each of subtree(top))
      assertBits(moved.world(each), whole.world(each), `seed ${seed} next pass`);
  }
});
