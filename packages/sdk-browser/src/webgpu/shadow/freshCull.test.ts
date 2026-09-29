// #1275: the cull of the pages the GPU draws itself (`freshCullWgsl.ts`) and their seal
// (`sealShadowPages`), run from their shipped WGSL: a region keeps every caster row its volume
// touches — the page table's and the blended casters' —, one pair each; a pair past the list's
// capacity is lost, and its region is not made readable but waits for its next draw.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_MAPPED,
  PAGE_VALID,
  SHADOW_TABLE_ENTRIES,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { SHADOW_TABLE_OFFSET } from '../../gpu/shadow/atlas.ts';
import { MOBILITY_CORNER_SHIFT } from '../../gpu/shadow/cullShader.ts';
import { runShadowFresh, runShadowPairs } from './freshRun.fixture.ts';
import { FRESH_ARG, FRESH_PARAMS, FRESH_REGION_PAGES, freshArgWords } from './freshLayout.ts';
import { DRAWN_GPU, DRAWN_NONE, POOL_COUNTS, POOL_FIELDS } from './poolWgsl.ts';

const PAGES = 4;
/** Two regions: a box of two metres around the origin, and a cone down from five metres up. */
function volumes() {
  const floats = new Float32Array(2 * 20);
  floats.set([0, 0, 0, 1, 0, 0, 1, -1, 1, 0, 0, 1, 0, 1, 0, 1]);
  floats.set([0, 5, 0, 10, 0, -1, 0, 0.1], 20);
  return new Uint8Array(floats.buffer);
}
/** The cull's inputs over `rows` spheres, the table's first `tableRows` then blended ones. */
function cull(rows: number[][], tableRows: number, capacity: number) {
  const spheres = new Float32Array(rows.flat()),
    mobility = Uint32Array.from(rows, (_, row) => (row + 1) << MOBILITY_CORNER_SHIFT),
    params = new Uint32Array(FRESH_PARAMS),
    args = new Uint32Array(freshArgWords(PAGES)),
    pairs = new Uint32Array(2 * rows.length * 2);
  params.set([
    PAGES,
    2,
    1,
    tableRows,
    tableRows + 2,
    Math.max(rows.length, tableRows + 2),
    capacity,
  ]);
  args.set([2, capacity]);
  runShadowPairs(
    ...[spheres, params, volumes(), pairs, args, mobility].map((a) => new Uint8Array(a.buffer)),
  );
  const kept = Array.from({ length: Math.min(args[FRESH_ARG.pairs], capacity) }, (_, i) => [
    pairs[2 * i],
    pairs[2 * i + 1],
  ]);
  return { kept, args, params };
}

test('a region keeps every caster row its volume touches, the blended ones too', () => {
  // Rows 0 and 1 of the table, then, past two rows no draw holds, a blended caster (row 4).
  const rows = [
    [0.9, 0.9, 0, 0.1], // in the box, off the cone
    [0, 2, 0, 0.1], // in the cone, over the box
    [40, 0, 0, 0.1],
    [40, 0, 0, 0.1],
    [0, 0.5, 0, 0.1], // blended, in both
  ];
  const { kept, args } = cull(rows, 2, 64);
  const byRegion = (k: number) =>
    kept
      .filter(([region]) => region === k)
      .map(([, r]) => r)
      .sort();
  assert.deepEqual(byRegion(0), [0, 4]);
  assert.deepEqual(byRegion(1), [1, 4]);
  assert.equal(args[FRESH_ARG.corners], 5, 'the most corners a kept row draws');
});

test('a region that lost a caster past the list is not made readable, the others are', () => {
  const { args, params } = cull(
    [
      [0.9, 0.9, 0, 0.1],
      [0, 2, 0, 0.1],
      [0, 0.5, 0, 0.1],
    ],
    3,
    2,
  );
  const lost = [0, 1].map((k) => args[FRESH_REGION_PAGES + PAGES + k]);
  assert.equal(lost.filter(Boolean).length, 1, 'one region lost a pair');
  // The two regions are pages 2 and 3, of entries 40 and 41, drawn by the GPU this frame.
  args.set([2, 3], FRESH_REGION_PAGES);
  const data = new Uint8Array(SHADOW_TABLE_OFFSET + SHADOW_TABLE_ENTRIES * 4),
    state = new Uint8Array((POOL_COUNTS.length + POOL_FIELDS.length * PAGES) * 4),
    table = new Uint32Array(data.buffer, SHADOW_TABLE_OFFSET),
    fields = new Int32Array(state.buffer, POOL_COUNTS.length * 4),
    drawnBy = fields.subarray(POOL_FIELDS.indexOf('drawnBy') * PAGES);
  fields.set([-1, -1, 40, 41]);
  drawnBy.set([0, 0, DRAWN_GPU, DRAWN_GPU]);
  table[40] = 2 | PAGE_MAPPED;
  table[41] = 3 | PAGE_MAPPED;
  const bytes = (a: Uint32Array) => new Uint8Array(a.buffer);
  runShadowFresh(
    'sealShadowPages',
    ...[data, state, new Uint8Array(16), new Uint8Array(16), new Uint8Array(16)],
    ...[bytes(args), bytes(params)],
  );
  lost.forEach((was, k) => {
    const [entry, page] = [40 + k, 2 + k];
    assert.equal(table[entry] & PAGE_VALID, was ? 0 : PAGE_VALID, `page ${page}`);
    assert.equal(drawnBy[page], was ? DRAWN_NONE : DRAWN_GPU, `page ${page}`);
  });
});
