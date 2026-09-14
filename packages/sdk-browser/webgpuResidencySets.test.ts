import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageRec } from './pageSelection.ts';
import { createCutDelta } from './webgpuCutDelta.ts';
import { createWebgpuPageTracking } from './webgpuPageTracking.ts';
import { createWebgpuResidencySets } from './webgpuResidencySets.ts';

const rec = (url: string, level: number) => ({ url, level }) as unknown as PageRec;
/** Sixteen opaque placements over eight pages — two placements share a page — plus four
 *  transparent pages the GPU cut never sees, and a two-page pinned cover. */
function scene() {
  const packed = Array.from({ length: 16 }, (_, id) => rec(`o${id >> 1}`, id >> 1));
  const transparent = Array.from({ length: 4 }, (_, id) => rec(`t${id}`, id));
  const cover = [rec('o0', 0), rec('t0', 0)];
  const tracking = createWebgpuPageTracking([...packed, ...transparent, ...cover]);
  const bootstrapKey = new Uint8Array(tracking.keyCount);
  for (const page of cover) bootstrapKey[tracking.keyOf(page)] = 1;
  const sets = createWebgpuResidencySets({ tracking, bootstrapKey, packedPages: packed });
  const pages: PageRec[] = [];
  const delta = createCutDelta(packed, pages);
  return { packed, transparent, tracking, bootstrapKey, sets, pages, delta };
}

/** What the whole-set version computed every image, written out in full. */
function reference(
  world: ReturnType<typeof scene>,
  cutIds: readonly number[],
  wantedNow: readonly PageRec[],
  shownNow: readonly PageRec[],
  room: number,
) {
  const { tracking, bootstrapKey, packed } = world,
    key = tracking.keyOf;
  const cover: number[] = [];
  for (let k = 0; k < tracking.keyCount; k++) if (bootstrapKey[k]) cover.push(k);
  const seen = new Set<number>();
  const desired = [...cutIds.filter((id) => !seen.has(id) && seen.add(id)).map((id) => packed[id])];
  desired.push(...wantedNow);
  const requested = new Set([...cover, ...desired.map(key)]);
  let records = desired.filter((page) => !bootstrapKey[key(page)]);
  if (records.length > room)
    records = [...records].sort((a, b) => (b.level ?? 0) - (a.level ?? 0)).slice(0, room);
  const wanted = new Set(records.map(key));
  const keep = new Set([...cover, ...wanted, ...shownNow.map(key)]);
  return { requested: requested.size, wanted, keep };
}

/** One image of the GPU-cut path, in the order the engine runs it. */
function frame(
  world: ReturnType<typeof scene>,
  cutIds: readonly number[],
  wantedNow: readonly PageRec[],
  shownNow: readonly PageRec[],
  room: number,
) {
  const { delta, sets, pages } = world;
  delta.apply(cutIds);
  sets.applyCut(delta);
  sets.releaseCpu();
  sets.refreshTransparentWanted(wantedNow);
  const requested = sets.requestedCount;
  sets.refreshTransparentShown(shownNow);
  const desired = [...pages, ...wantedNow];
  sets.applyBudget(room, desired, wantedNow);
  return { requested, keep: sets.keepCount };
}

const keysOf = (set: { list: Int32Array; count: number }) =>
  new Set([...set.list.subarray(0, set.count)]);

function check(
  world: ReturnType<typeof scene>,
  cutIds: readonly number[],
  wantedNow: readonly PageRec[],
  shownNow: readonly PageRec[],
  room: number,
  label: string,
) {
  const got = frame(world, cutIds, wantedNow, shownNow, room);
  const want = reference(world, cutIds, wantedNow, shownNow, room);
  assert.equal(got.requested, want.requested, `${label}: pages demandées`);
  assert.deepEqual(keysOf(world.tracking.wanted), want.wanted, `${label}: file de résidence`);
  assert.deepEqual(keysOf(world.tracking.keep), want.keep, `${label}: ensemble gardé`);
  assert.equal(got.keep, want.keep.size, `${label}: taille gardée`);
}

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
