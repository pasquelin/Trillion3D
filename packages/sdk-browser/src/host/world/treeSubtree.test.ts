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

/** New poses on a random share of `root`'s subtree: what a move, or a host between two moves
 *  inside that subtree, writes. `root` itself always moves. */
function moveSubtree(draw: Draw, root: Object3D) {
  drawPose(draw, root, true);
  root.traverse((node) => void (node !== root && draw() < 0.3 && drawPose(draw, node, true)));
}

// Finite poses are the twin worlds' (`transformSubtree.test.ts`): here the hostile ones.
test('refreshFrom: the bits of the whole pass on every node, hostile poses', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const draw = seeded(seed * 7919);
    const { top, source, nodes } = randomTree(draw, 5 + Math.floor(draw() * 60), 6, true);
    // The index a move now refreshes by subtree, and the one it refreshed whole.
    const moved = hostWorldPlacements(source),
      whole = hostWorldPlacements(source);
    const all: Object3D[] = [];
    top.traverse((node) => void all.push(node));
    for (let step = 0; step < 12; step++) {
      const node = pick(draw, nodes);
      moveSubtree(draw, node);
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
