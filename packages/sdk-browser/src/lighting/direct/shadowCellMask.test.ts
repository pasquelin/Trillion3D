// #1211: a page is listed once per frame however many pixels read it, but every cell its readers
// take reaches its footprint. The shipped request WGSL, run through `shaderRun` over a request
// buffer, marks several pixels reading different cells of one page, a claim that named no cell
// first; the host reads the frame's cell table and draws the page for all of them, never the first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemandFootprints } from '../../../../sdk-core/src/scene/light-shadow/demandFootprint.ts';
import { pageFootprint } from '../../../../sdk-core/src/scene/light-shadow/footprint.ts';
import { DRAW_ALL, createShadowPool } from '../../../../sdk-core/src/scene/light-shadow/pool.ts';
import { createShadowTable } from '../../../../sdk-core/src/scene/light-shadow/table.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { shadowRequestBits, shadowRequestWgsl, shadowRequestWords } from './shadowRequestWgsl.ts';

type Requests = {
  requestShadowPage: (e: number) => void;
  requestShadowPageAt: (e: number, cell: number) => void;
  requestShadowMiss: (e: number, cell: number) => void;
  shadowRequestCell: (local: number[]) => number;
};
const FUNCTIONS = [
  'requestShadowPage',
  'requestShadowPageAt',
  'requestShadowMiss',
  'markShadowCell',
  'shadowClaimMarked',
  'shadowClaimMiss',
  'shadowRequestCell',
];

/** A request buffer of a list of `cap`, and the shipped requests over it. */
function requestsOf(cap: number) {
  const buffer = new Uint32Array(shadowRequestWords(cap));
  const run = shaderRun<Requests>(shadowRequestWgsl(0), FUNCTIONS, { shadowRequests: buffer });
  return { buffer, run, cells: () => buffer.subarray(1 + cap + shadowRequestBits()) };
}

test('pixels reading different cells of one page, listed once, all reach its footprint', () => {
  const table = createShadowTable(1024),
    pool = createShadowPool(32);
  pool.beginAllocation(0);
  const page = pool.take(table, 7, 0, 0, 0);
  pool.drew(table, page, DRAW_ALL, 0);
  const { buffer, run, cells } = requestsOf(8);
  // The floors' claim names no cell and lists the page first; then four pixels, three cells.
  run.requestShadowPage(7);
  for (const texel of [
    [5, 5],
    [100, 3],
    [101, 4],
    [40, 70],
  ])
    run.requestShadowPageAt(7, run.shadowRequestCell(texel));
  assert.equal(buffer[0], 1, 'the page is listed once');
  assert.equal(buffer[1], 7);
  const footprints = createDemandFootprints(table, pool),
    report = { frame: 1, layoutEpoch: table.layoutEpoch, stamp: 0, count: 1 };
  footprints.read({ ...report, entries: buffer.slice(1, 2), cells: cells() }, 0, 1);
  assert.equal(footprints.widened, 1);
  assert.equal(pool.footprint[page], pageFootprint(0, 0, 127, 95), 'every cell, not the first');
  // A reader outside it sets its cell too: the page grows by that cell alone.
  const before = pool.footprint[page];
  cells().fill(0);
  run.requestShadowMiss(7, run.shadowRequestCell([120, 120]));
  footprints.read({ ...report, entries: buffer.slice(1, 2), cells: cells() }, 0, 2);
  assert.equal(pool.footprint[page], pageFootprint(0, 0, 127, 127));
  assert.notEqual(before, pool.footprint[page]);
});

test('a mark that finds no slot left in the cell table sets its overflow word', () => {
  const { run, cells } = requestsOf(1);
  // Two slots: the third page finds none.
  for (const e of [3, 4, 5]) run.requestShadowPageAt(e, 0);
  assert.equal(cells()[0], 1, 'the frame\u2019s masks are partial');
});
