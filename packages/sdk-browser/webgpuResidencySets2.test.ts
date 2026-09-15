import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageRec } from './pageSelection.ts';
import { createCutDelta } from './webgpuCutDelta.ts';
import { frame, keysOf, scene } from './webgpuResidencySetsFixture.ts';

test('what the image draws is held even when the cut never asked for it', () => {
  const world = scene();
  const { sets, tracking, packed } = world;
  const at = (id: number) => tracking.keyOf(packed[id]);
  const drawn = createCutDelta(packed, [] as PageRec[]);
  // The cut asks for two fine clusters whose pages have not arrived, so the image draws a coarse
  // ancestor the cut never named. Nothing else holds it: without this hold the cache is free to
  // reclaim, under the image, the surface that image is showing.
  frame(world, [4, 6], [], [], 64);
  drawn.apply([12]);
  sets.applyDrawn(drawn);
  assert.equal(tracking.keep.has(at(12)), true, 'ancêtre dessiné gardé');
  assert.equal(tracking.wanted.has(at(12)), false, 'ancêtre dessiné non demandé');
  // The fine clusters arrive and take the image: the ancestor leaves it, and the hold leaves with it.
  drawn.apply([4, 6]);
  sets.applyDrawn(drawn);
  assert.equal(tracking.keep.has(at(12)), false, 'ancêtre relâché dès qu’il n’est plus dessiné');
  assert.equal(tracking.keep.has(at(4)), true);
  // A drawable cut that does not move touches nothing at all.
  drawn.apply([4, 6]);
  assert.equal(drawn.enteredCount + drawn.exitedCount, 0);
  const before = keysOf(tracking.keep);
  sets.applyDrawn(drawn);
  assert.deepEqual(keysOf(tracking.keep), before);
});

test('the queue is a function of the cut and the budget, not of the order pages arrived in', () => {
  const target = [1, 3, 5, 7, 9, 11, 13, 15];
  // The same cut reached through different histories: one image, or five that grew into it.
  const histories: number[][][] = [
    [target],
    [[1], [1, 3, 5], [1, 3, 5, 7, 9], target],
    [[0, 2, 4, 6, 8, 10, 12, 14], [], [15, 13], target],
  ];
  for (const room of [2, 3, 5, 64]) {
    const reference = new Set<number>();
    histories.forEach((history, index) => {
      const world = scene();
      for (const ids of history) frame(world, ids, [], [], room);
      const queue = keysOf(world.tracking.wanted);
      if (index === 0) for (const key of queue) reference.add(key);
      else assert.deepEqual(queue, reference, `budget ${room}, histoire ${index}`);
    });
  }
});
