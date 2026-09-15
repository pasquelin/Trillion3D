import test from 'node:test';
import assert from 'node:assert/strict';
import { check, frame, keysOf, scene } from './webgpuResidencySetsFixture.ts';

test('the incremental sets answer what the whole-set version answered, image after image', () => {
  const world = scene();
  const { transparent } = world;
  const room = 64;
  // A camera that moves: the cut grows, slides, shrinks, empties and comes back.
  const cuts: number[][] = [
    [0, 1, 2, 3],
    [0, 1, 2, 3],
    [2, 3, 4, 5, 6],
    [6, 7, 8, 9, 10, 11],
    [],
    [1, 3, 5, 7, 9, 11, 13, 15],
    [0, 2, 4],
  ];
  cuts.forEach((ids, index) => {
    const wantedNow = transparent.slice(0, (index % 4) + 1);
    const shownNow = transparent.slice(0, (index + 2) % 5);
    check(world, ids, wantedNow, shownNow, room, `image ${index}`);
  });
});

test('a cut wider than the page budget keeps the same coarse subset as the whole-set version', () => {
  const world = scene();
  const { transparent } = world;
  for (const room of [0, 1, 3, 6, 9, 14]) {
    const world2 = scene();
    check(
      world2,
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      transparent,
      transparent.slice(0, 2),
      room,
      `budget ${room}`,
    );
    check(
      world2,
      [4, 5, 6, 7, 8, 9, 10, 11],
      transparent.slice(0, 2),
      transparent,
      room,
      `budget ${room} bis`,
    );
    // Back under the budget: the queue is the desired set again.
    check(world2, [0, 1], transparent.slice(0, 1), [], 64, `budget ${room} relâché`);
  }
  assert.equal(world.tracking.wanted.count, 0);
});

test('the CPU cut owns the sets while it drives, and hands them back afterwards', () => {
  const world = scene();
  const { sets, tracking, delta, packed, transparent, bootstrapKey } = world;
  frame(world, [0, 1, 2, 3], transparent.slice(0, 2), transparent.slice(0, 1), 64);
  const cpuWanted = [packed[10], packed[11], transparent[3]];
  sets.refreshCpu(cpuWanted, [packed[10], transparent[3]]);
  delta.invalidate();
  assert.deepEqual(
    keysOf(tracking.wanted),
    new Set(cpuWanted.map(tracking.keyOf).filter((key) => !bootstrapKey[key])),
  );
  // The GPU cut takes over: its difference re-seeds, and the CPU sets are released.
  check(world, [0, 1], transparent.slice(0, 1), transparent.slice(0, 1), 64, 'retour coupe GPU');
});

test('an image that moves no page touches no set at all', () => {
  const world = scene();
  const { delta, sets, transparent, tracking } = world;
  const ids = [0, 1, 2, 3, 4, 5];
  frame(world, ids, transparent, transparent, 64);
  const wantedBefore = [...tracking.wanted.list.subarray(0, tracking.wanted.count)];
  const listBefore = tracking.wanted.list;
  // The pin step drains these; nothing else may add to them once the cut stops moving.
  const entering = sets.entering.count,
    leaving = sets.leaving.count;
  for (let image = 0; image < 100; image++) {
    frame(world, ids, transparent, transparent, 64);
    assert.equal(delta.enteredCount, 0);
    assert.equal(delta.exitedCount, 0);
  }
  assert.equal(sets.entering.count, entering);
  assert.equal(sets.leaving.count, leaving);
  // Same backing array, same members, in the same places: nothing was rebuilt or reallocated.
  assert.equal(tracking.wanted.list, listBefore);
  assert.deepEqual([...tracking.wanted.list.subarray(0, tracking.wanted.count)], wantedBefore);
});
