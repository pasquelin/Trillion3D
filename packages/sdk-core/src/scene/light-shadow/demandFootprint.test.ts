// #1211: a page's shadow casters are culled to the footprint its receivers read, grown as more
// name it — never less while it is mapped, so what a reader took stays covered. A reader whose
// texel the footprint misses says so in the readback (`SHADOW_REQUEST_MISS`), and its page is
// drawn whole; a page drawn for a part of a page is stale, never current.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_FOOTPRINT_EMPTY,
  PAGE_FOOTPRINT_FULL,
  PAGE_FOOTPRINT_SHIFT,
  SHADOW_REQUEST_CELL_MASK,
  SHADOW_REQUEST_CELL_SHIFT,
  SHADOW_REQUEST_ENTRY_MASK,
  SHADOW_REQUEST_MISS,
  cellFootprint,
  footprintDrawn,
  footprintRect,
  footprintUnion,
  pageFootprint,
} from './footprint.ts';
import { createDemandFootprints, reachFootprint } from './demandFootprint.ts';
import { DRAW_ALL, STALE_FULL, createShadowPool } from './pool.ts';
import { createShadowTable } from './table.ts';
import { shadowTableEntries } from './virtual.ts';

const narrow = pageFootprint(0, 0, 32, 32),
  wider = pageFootprint(8, 8, 40, 40);

test('a footprint grows by union, never narrows; a page no receiver named is drawn whole', () => {
  assert.equal(footprintDrawn(PAGE_FOOTPRINT_EMPTY), PAGE_FOOTPRINT_FULL);
  assert.equal(footprintDrawn(narrow), narrow);
  // The neutral empty edge is every step in: naming a page once leaves that name alone.
  assert.equal(footprintUnion(PAGE_FOOTPRINT_EMPTY, narrow), narrow);
  assert.equal(footprintUnion(narrow, PAGE_FOOTPRINT_EMPTY), narrow);
  // A whole page stays whole, whichever name reaches it.
  assert.equal(footprintUnion(PAGE_FOOTPRINT_FULL, narrow), PAGE_FOOTPRINT_FULL);
  // The union covers both: growing to it never loses a texel either name held.
  assert.equal(
    footprintUnion(narrow, wider),
    footprintUnion(narrow, footprintUnion(narrow, wider)),
  );
});

test('a page\u2019s casters are culled to its footprint grown by the filter\u2019s reach', () => {
  const page = new Float64Array([0, 1, 0, 1]),
    out = new Float64Array(4);
  assert.deepEqual(
    footprintRect(out, PAGE_FOOTPRINT_FULL, 3, page),
    page,
    'whole: the page itself',
  );
  footprintRect(out, narrow, 3, page);
  assert.ok(out[0] === page[0] && out[3] === page[3], 'its near edges hold');
  assert.ok(out[1] < page[1] && out[2] > page[2], 'its far edges are pulled to the footprint');
});

test('growing a page\u2019s footprint stales it in full, once; a whole page never grows', () => {
  const table = createShadowTable(1024),
    pool = createShadowPool(32);
  pool.beginAllocation(0);
  const entry = 7,
    page = pool.take(table, entry, 0, 0, 0);
  assert.ok(page >= 0);
  // No receiver named it yet: drawn whole, its word what it always was.
  pool.drew(table, page, DRAW_ALL, 0);
  assert.equal(pool.footprint[page], PAGE_FOOTPRINT_EMPTY, 'no receiver named it yet');
  assert.equal(table.words[entry] >>> PAGE_FOOTPRINT_SHIFT, PAGE_FOOTPRINT_FULL);
  // A receiver's footprint is what it holds, and what its word names.
  pool.drew(table, page, DRAW_ALL, 0, narrow);
  assert.equal(pool.footprint[page], narrow);
  assert.equal(table.words[entry] >>> PAGE_FOOTPRINT_SHIFT, narrow);
  // Growing it stales the page in full — its static layer too —, and only the first time.
  assert.equal(reachFootprint(pool, page, wider, 0, 1), true);
  assert.equal(pool.footprint[page], footprintUnion(narrow, wider));
  assert.equal(pool.dirty[page], STALE_FULL);
  assert.equal(reachFootprint(pool, page, wider, 0, 2), false, 'already at least as wide');
  // Drawn current again at what it grew to: a name reaching past it stales it once more.
  pool.drew(table, page, DRAW_ALL, 0, footprintUnion(narrow, wider));
  assert.equal(reachFootprint(pool, page, PAGE_FOOTPRINT_FULL, 0, 3), true, 'whole is wider');
  assert.equal(pool.footprint[page], PAGE_FOOTPRINT_FULL);
});

test('a per-pixel mark narrows its page to the cell its receiver reads, and counts it', () => {
  const table = createShadowTable(1024),
    pool = createShadowPool(32);
  pool.beginAllocation(0);
  const entry = 7,
    page = pool.take(table, entry, 0, 0, 0),
    footprints = createDemandFootprints(table, pool);
  pool.drew(table, page, DRAW_ALL, 0);
  // The demand marked entry 7 for the cell at page texel (96, 96): the last cell of the page.
  const cell = 1 + 3 + 4 * 3,
    mark = (layoutEpoch: number, code: number) => ({
      frame: 1,
      layoutEpoch,
      stamp: 0,
      count: 1,
      entries: Uint32Array.of(entry | (code << SHADOW_REQUEST_CELL_SHIFT)),
    });
  footprints.widened = 0;
  footprints.read(mark(table.layoutEpoch, cell), 0, 1);
  assert.equal(footprints.widened, 1);
  assert.equal(pool.footprint[page], cellFootprint(cell), 'narrowed to the cell read');
  assert.notEqual(cellFootprint(cell), PAGE_FOOTPRINT_FULL);
  // Another layout: nothing grows.
  footprints.widened = 0;
  footprints.read(mark(table.layoutEpoch + 1, cell), 0, 2);
  assert.equal(footprints.widened, 0);
});

test('a reader that misses the footprint grows its page by the cell of its texel, counted once', () => {
  const table = createShadowTable(1024),
    pool = createShadowPool(32);
  pool.beginAllocation(0);
  const entry = 7,
    page = pool.take(table, entry, 0, 0, 0),
    plain = pool.take(table, 8, 0, 0, 0),
    footprints = createDemandFootprints(table, pool);
  pool.drew(table, page, DRAW_ALL, 0, narrow);
  pool.drew(table, plain, DRAW_ALL, 0, narrow);
  // The read missed its page at page texel (96, 0): the miss names that cell, not the whole page.
  const cell = 1 + 3,
    missed = (layoutEpoch: number, entries: number[]) => ({
      frame: 1,
      layoutEpoch,
      stamp: 0,
      count: entries.length,
      entries: Uint32Array.from(entries),
    }),
    miss = (target: number, code: number) =>
      target | SHADOW_REQUEST_MISS | (code << SHADOW_REQUEST_CELL_SHIFT);
  footprints.widened = 0;
  footprints.read(missed(table.layoutEpoch, [miss(entry, cell)]), 0, 1);
  assert.equal(footprints.widened, 1);
  assert.equal(pool.footprint[page], footprintUnion(narrow, cellFootprint(cell)));
  // A miss that named no cell still draws the page whole, as before.
  footprints.widened = 0;
  footprints.read(missed(table.layoutEpoch, [miss(8, 0)]), 0, 2);
  assert.equal(footprints.widened, 1);
  assert.equal(pool.footprint[plain], PAGE_FOOTPRINT_FULL, 'the page is drawn whole');
  // A report read against another table layout names ranges that moved: nothing grows.
  footprints.widened = 0;
  footprints.read(missed(table.layoutEpoch + 1, [miss(entry, cell)]), 0, 3);
  assert.equal(footprints.widened, 0);
});

test('a mark keeps its entry and its cell on a wider window than the ordinary one', () => {
  // The boss's reference view (1117 CSS at DPR 2, 55°) opens a 68-page sun window
  // (`referenceSunWindow`): its table outgrows the ordinary one, and its last entry and the cell
  // above it must not share a bit, a miss's flag included.
  const last = shadowTableEntries(68) - 1;
  for (const flag of [0, SHADOW_REQUEST_MISS]) {
    const word = (last | (16 << SHADOW_REQUEST_CELL_SHIFT) | flag) >>> 0;
    assert.equal(word & SHADOW_REQUEST_ENTRY_MASK, last);
    assert.equal((word >>> SHADOW_REQUEST_CELL_SHIFT) & SHADOW_REQUEST_CELL_MASK, 16);
    assert.equal(word >= SHADOW_REQUEST_MISS, flag !== 0);
  }
});
