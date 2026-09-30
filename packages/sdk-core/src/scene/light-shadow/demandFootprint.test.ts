// #1211: a page's shadow casters are culled to the footprint its receivers read, grown as more
// name it — never less while it is mapped, so what a reader took stays covered. A reader whose
// texel the footprint misses says so in the readback (`SHADOW_REQUEST_MISS`), and its page is
// drawn whole; a page drawn for a part of a page is stale, never current.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_FOOTPRINT_EMPTY,
  PAGE_FOOTPRINT_FULL,
  SHADOW_REQUEST_MISS,
  footprintDrawn,
  footprintRect,
  footprintUnion,
} from './footprint.ts';
import { createDemandFootprints } from './demandFootprint.ts';
import { DRAW_ALL, createShadowPool } from './pool.ts';
import { createShadowTable } from './table.ts';
import { pageFootprint } from './footprint.fixture.ts';

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

test('a reader that misses the footprint names its page: drawn whole, counted widened', () => {
  const table = createShadowTable(1024),
    pool = createShadowPool(32);
  pool.beginAllocation(0);
  const entry = 7,
    page = pool.take(table, entry, 0, 0, 0),
    footprints = createDemandFootprints(table, pool);
  pool.drew(table, page, DRAW_ALL, 0, narrow);
  const missed = (layoutEpoch: number) => ({
    frame: 1,
    layoutEpoch,
    stamp: 0,
    count: 1,
    entries: Uint32Array.of(entry | SHADOW_REQUEST_MISS),
  });
  footprints.widened = 0;
  footprints.missed(missed(table.layoutEpoch), 0, 1);
  assert.equal(footprints.widened, 1);
  assert.equal(pool.footprint[page], PAGE_FOOTPRINT_FULL, 'the page is drawn whole');
  // A report read against another table layout names ranges that moved: nothing grows.
  footprints.widened = 0;
  footprints.missed(missed(table.layoutEpoch + 1), 0, 2);
  assert.equal(footprints.widened, 0);
});
