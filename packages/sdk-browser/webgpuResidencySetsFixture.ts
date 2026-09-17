import assert from 'node:assert/strict';
import type { PageRec } from './pageSelection.ts';
import { createCutDelta } from './webgpuCutDelta.ts';
import { createWebgpuPageTracking } from './webgpuPageTracking.ts';
import { createWebgpuResidencySets } from './webgpuResidencySets.ts';

const rec = (url: string, level: number) => ({ url, level }) as unknown as PageRec;

/** Sixteen opaque placements over eight pages — two placements share a page — then four
 *  transparent clusters of the same cut, and a two-page pinned cover. One catalogue, one cut. */
export function scene() {
  const opaque = Array.from({ length: 16 }, (_, id) => rec(`o${id >> 1}`, id >> 1));
  const transparent = Array.from({ length: 4 }, (_, id) => rec(`t${id}`, id));
  const packed = [...opaque, ...transparent];
  // Le rang de la page voyage sur la page, comme le catalogue du moteur le pose.
  packed.forEach((page, index) => (page.packedIndex = index));
  const cover = [rec('o0', 0), rec('t0', 0)];
  const tracking = createWebgpuPageTracking([...packed, ...cover]);
  const bootstrapKey = new Uint8Array(tracking.keyCount);
  for (const page of cover) bootstrapKey[tracking.keyOf(page)] = 1;
  const sets = createWebgpuResidencySets({ tracking, bootstrapKey, packedPages: packed });
  const pages: PageRec[] = [];
  const delta = createCutDelta(packed, pages);
  return { packed, transparent, tracking, bootstrapKey, sets, pages, delta };
}

/** What the whole-set version computed every image, written out in full. The budget counts slots,
 *  and one page is one slot: the cut is deduplicated before it is cut. */
function reference(world: ReturnType<typeof scene>, cutIds: readonly number[], room: number) {
  const { tracking, bootstrapKey, packed } = world,
    key = tracking.keyOf;
  const cover: number[] = [];
  for (let k = 0; k < tracking.keyCount; k++) if (bootstrapKey[k]) cover.push(k);
  const seen = new Set<number>();
  const desired = cutIds.filter((id) => !seen.has(id) && seen.add(id)).map((id) => packed[id]);
  const requested = new Set([...cover, ...desired.map(key)]);
  const pages: PageRec[] = [],
    kept = new Set<number>();
  for (const page of desired) {
    if (bootstrapKey[key(page)] || kept.has(key(page))) continue;
    kept.add(key(page));
    pages.push(page);
  }
  let records = pages;
  if (records.length > room)
    records = [...records].sort((a, b) => (b.level ?? 0) - (a.level ?? 0)).slice(0, room);
  const wanted = new Set(records.map(key));
  const keep = new Set([...cover, ...wanted]);
  return { requested: requested.size, wanted, keep };
}

/** One image of the GPU-cut path, in the order the engine runs it. */
export function frame(world: ReturnType<typeof scene>, cutIds: readonly number[], room: number) {
  const { delta, sets, pages } = world;
  delta.apply(cutIds);
  sets.applyCut(delta);
  const requested = sets.requestedCount;
  sets.applyBudget(room, pages);
  return { requested, keep: sets.keepCount };
}

export const keysOf = (set: { list: Int32Array; count: number }) =>
  new Set([...set.list.subarray(0, set.count)]);

export function check(
  world: ReturnType<typeof scene>,
  cutIds: readonly number[],
  room: number,
  label: string,
) {
  const got = frame(world, cutIds, room);
  const want = reference(world, cutIds, room);
  assert.equal(got.requested, want.requested, `${label}: pages demandées`);
  assert.deepEqual(keysOf(world.tracking.wanted), want.wanted, `${label}: file de résidence`);
  assert.deepEqual(keysOf(world.tracking.keep), want.keep, `${label}: ensemble gardé`);
  assert.equal(got.keep, want.keep.size, `${label}: taille gardée`);
}
