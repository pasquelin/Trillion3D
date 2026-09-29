// #1275: the cull of the pages the GPU draws itself (`freshCullWgsl.ts`) and their seal
// (`sealShadowPages`), run from their shipped WGSL: a region keeps every caster row its volume
// touches — the page table's and the blended casters' —, one pair each; no more pages are picked
// than the pair list holds every row of, and the others wait, unread, for the next frame.
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
import {
  FRESH_ARG,
  FRESH_FACE_WORDS,
  FRESH_PARAMS,
  FRESH_REGION_PAGES,
  freshArgWords,
} from './freshLayout.ts';
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

test('no more pages are picked than the pair list holds every row of; the rest wait, unread', () => {
  // Six listed pages of a pool of sixteen, three caster rows, room for seven pairs: two regions.
  const pages = 16,
    listed = 6,
    rows = 3,
    capacity = 7;
  const data = new Uint8Array(SHADOW_TABLE_OFFSET + SHADOW_TABLE_ENTRIES * 4),
    state = new Uint32Array(POOL_COUNTS.length + POOL_FIELDS.length * pages),
    table = new Uint32Array(data.buffer, SHADOW_TABLE_OFFSET),
    fields = new Int32Array(state.buffer, POOL_COUNTS.length * 4),
    drawnBy = fields.subarray(POOL_FIELDS.indexOf('drawnBy') * pages),
    drawList = Uint32Array.from({ length: pages }, (_, i) => i),
    params = new Uint32Array(FRESH_PARAMS),
    args = new Uint32Array(freshArgWords(pages)),
    volumeFloats = new Float32Array(pages * 20);
  fields.fill(-1, 0, pages);
  drawnBy.fill(DRAWN_NONE);
  for (let p = 0; p < listed; p++) {
    fields[p] = 40 + p;
    table[40 + p] = p | PAGE_MAPPED;
  }
  state[POOL_COUNTS.indexOf('drawn')] = listed;
  params.set([pages, 4, 1, rows, rows, rows, capacity]);
  const bytes = (a: Uint32Array | Float32Array) => new Uint8Array(a.buffer);
  const fresh = (entry: string) =>
    runShadowFresh(
      entry,
      ...[data, bytes(state), bytes(drawList), new Uint8Array(pages * 4 * FRESH_FACE_WORDS)],
      ...[bytes(volumeFloats), bytes(args), bytes(params), new Uint8Array(12)],
    );
  fresh('composeShadowPages');
  const regions = args[FRESH_ARG.regions];
  assert.equal(regions, Math.floor(capacity / rows), 'as many regions as hold every row');
  // Every region's volume holds every caster: the cull keeps a pair of each row for each.
  for (let k = 0; k < regions; k++)
    volumeFloats.set([0, 0, 0, 1e6, 0, 0, 1, -1, 1, 0, 0, 1e6, 0, 1, 0, 1e6], k * 20);
  const spheres = new Float32Array(Array.from({ length: rows }, () => [0, 0, 0, 1]).flat()),
    pairs = new Uint32Array(2 * capacity);
  runShadowPairs(...[spheres, params, volumeFloats, pairs, args, new Uint32Array(rows)].map(bytes));
  assert.equal(args[FRESH_ARG.pairs], regions * rows, 'every pair kept, none past the list');
  fresh('sealShadowPages');
  for (let p = 0; p < listed; p++) {
    const picked = [...args.subarray(FRESH_REGION_PAGES, FRESH_REGION_PAGES + regions)].includes(p);
    assert.equal(table[40 + p] & PAGE_VALID, picked ? PAGE_VALID : 0, `page ${p}`);
    assert.equal(drawnBy[p], picked ? DRAWN_GPU : DRAWN_NONE, `page ${p}`);
  }
});
