// #477: the pin step's work follows what changed, never what is held or drawn. A still image
// touches nothing; a small move touches a bounded number of records per page that moved.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageRec } from '../../page/selection/selection.ts';
import { createCutDelta } from '../cut/delta.ts';
import { createWebgpuPageTracking } from '../row/pageTracking.ts';
import { LAST_USE_WINDOW as W } from './lastUse.ts';
import { createWebgpuPinUpdater } from './pinUpdater.ts';
import { createWebgpuResidencySets } from './sets.ts';
import { lruCache, pageOf } from './residentEnsurer.fixture.ts';

/** A binary DAG of `leaves` leaves, heap-ordered: page `i` depends on page `(i - 1) >> 1`. All
 *  resident. Returns an image driver and the work counter every cache and DAG read feeds. */
function tree(leaves: number, room: number) {
  const packed = Array.from({ length: 2 * leaves - 1 }, (_, i) => pageOf(`p${i}`));
  packed.forEach((page, index) => (page.packedIndex = index));
  const work = { reads: 0 };
  const parents = packed.map((_, i) => (i ? [packed[(i - 1) >> 1]] : []));
  const parentsOf = (rec: PageRec) => (work.reads++, parents[rec.packedIndex!]);
  const tracking = createWebgpuPageTracking(packed);
  const sets = createWebgpuResidencySets({
    tracking,
    bootstrapKey: new Uint8Array(tracking.keyCount),
    packedPages: packed,
  });
  const cut = createCutDelta(packed, []),
    drawn = createCutDelta(packed, []);
  const cache = lruCache(packed.length);
  for (const page of packed) void cache.load(page.url);
  for (const name of ['get', 'pin', 'unpin', 'touch'] as const) {
    const call = cache[name] as (url: string) => unknown;
    (cache as Record<string, unknown>)[name] = (url: string) => (work.reads++, call(url));
  }
  const pins = createWebgpuPinUpdater({
    tracking,
    sets,
    bootstrapUrls: new Set(),
    deferredDrops: new Set(),
    byUrl: new Map(),
    parentsOf,
    traceEnabled: false,
    traceDiagnostic: () => {},
  });
  const first = leaves - 1;
  /** One image drawing leaves `[from, from + span)`; returns the work it did. */
  const image = (frame: number, from: number, span: number) => {
    const ids = Array.from({ length: span }, (_, i) => first + from + i);
    work.reads = 0;
    cut.apply(ids);
    sets.applyCut(cut);
    // Past the budget the image draws what the pool holds, not the cut: the queue alone keeps it.
    drawn.apply(room < span ? [] : ids);
    sets.applyDrawn(drawn);
    sets.applyBudget(room);
    // Every key the pin step is handed is a record it reads.
    work.reads += sets.entering.count + sets.leaving.count;
    pins(cache as never, [], frame, () => {});
    return work.reads;
  };
  return { image };
}

for (const [label, room] of [
  ['within the page budget', 4096],
  ['past the page budget', 192],
] as const)
  test(`${label}, a still image and a small move touch records by what moved`, () => {
    const span = 256,
      world = tree(1024, room);
    let frame = 0;
    for (let i = 0; i <= 2 * W; i++) world.image(++frame, 0, span);
    assert.equal(world.image(++frame, 0, span), 0, 'a still image touches nothing');
    // One leaf leaves and one joins, image after image: the work is that of the two pages that
    // moved and of the ancestors a new leaf holds for the first time — a few records per level of
    // the DAG —, never that of the 256 leaves the image holds.
    const depth = Math.log2(1024) + 1;
    let from = 0,
      most = 0;
    for (let i = 0; i < 4 * W; i++) most = Math.max(most, world.image(++frame, ++from, span));
    assert.ok(most <= 4 * depth, `a one-leaf move touched ${most} records`);
  });
