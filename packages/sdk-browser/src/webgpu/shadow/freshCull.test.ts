// #1275: the cull of the pages the GPU draws itself (`freshCullWgsl.ts`) and their seal
// (`sealShadowPages`), run from their shipped WGSL: a region keeps every caster row its volume
// touches — the page table's and the blended casters' —, one pair each; every listed page is picked
// and drawn when the pairs it keeps fit the list (#1363); past the list, the longest prefix of whole
// regions is admitted — one left short keeps no pair and waits, unread and unclaimed —, and the
// kept list, grown to the pairs the seal counted (`pairGrowth.ts`), draws every page the next frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_MAPPED,
  PAGE_VALID,
  SHADOW_TABLE_ENTRIES,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { SHADOW_TABLE_OFFSET } from '../../gpu/shadow/atlas.ts';
import { MOBILITY_CORNER_SHIFT } from '../../gpu/shadow/cullShader.ts';
import { runShadowFresh, runShadowPairs } from './freshRun.fixture.ts';
import { keptPairs, keptRows } from './pairRows.ts';
import {
  FRESH_ARG,
  FRESH_CASTERS,
  FRESH_FACE_WORDS,
  FRESH_PARAMS,
  FRESH_REGION_PAGES,
  freshArgWords,
  freshDrawWord,
} from './freshLayout.ts';
import { POOL_COUNTS, POOL_FIELDS } from './allocLayout.ts';
import { DRAWN_GPU, DRAWN_NONE } from './poolDrawn.ts';

const PAGES = 4,
  /** The float of a region's volume its texels per metre take (`Face.texel`). */
  TEXEL = 18;
/** Two regions: a box of two metres around the origin, and a cone down from five metres up; a
 *  texel a metre each (`Face.texel`), every row of one level. */
function volumes() {
  const floats = new Float32Array(2 * SHADOW_CULL_FLOATS);
  floats.set([0, 0, 0, 1, 0, 0, 1, -1, 1, 0, 0, 1, 0, 1, 0, 1]);
  floats.set([0, 5, 0, 10, 0, -1, 0, 0.1], SHADOW_CULL_FLOATS);
  floats[TEXEL] = floats[SHADOW_CULL_FLOATS + TEXEL] = 1;
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
  args[FRESH_ARG.regions] = 2;
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

/** Six listed pages of a pool of sixteen, three caster rows, room for `capacity` pairs; each
 *  region's volume holds the rows `holds(k)` says. The compose, the cull and the seal, run in turn:
 *  the pages picked, the pairs kept, the pairs counted, and which listed page is readable and
 *  claimed. */
function frame(capacity: number, holds: (k: number) => number[]) {
  const pages = 16,
    listed = 6,
    rows = 3;
  const data = new Uint8Array(SHADOW_TABLE_OFFSET + SHADOW_TABLE_ENTRIES * 4),
    state = new Uint32Array(POOL_COUNTS.length + POOL_FIELDS.length * pages),
    table = new Uint32Array(data.buffer, SHADOW_TABLE_OFFSET),
    fields = new Int32Array(state.buffer, POOL_COUNTS.length * 4),
    drawnBy = fields.subarray(POOL_FIELDS.indexOf('drawnBy') * pages),
    drawList = Uint32Array.from({ length: pages }, (_, i) => i),
    params = new Uint32Array(FRESH_PARAMS),
    args = new Uint32Array(freshArgWords(pages)),
    volumeFloats = new Float32Array(pages * SHADOW_CULL_FLOATS);
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
  const regions = args[FRESH_ARG.regions],
    picked = [...args.subarray(FRESH_REGION_PAGES, FRESH_REGION_PAGES + regions)];
  // Every region a box that holds every row; one holding row 0 alone is two metres wide on its
  // right axis, where the other rows lie fifty metres out.
  for (let k = 0; k < regions; k++) {
    volumeFloats.set(
      [0, 0, 0, 1e6, 0, 0, 1, -1, 1, 0, 0, 1e6, 0, 1, 0, 1e6],
      k * SHADOW_CULL_FLOATS,
    );
    volumeFloats[k * SHADOW_CULL_FLOATS + TEXEL] = 1;
  }
  const spheres = new Float32Array(rows * 4),
    pairs = new Uint32Array(2 * capacity);
  for (let k = 0; k < regions; k++)
    if (holds(k).length < rows) volumeFloats[k * SHADOW_CULL_FLOATS + 11] = 1;
  for (let row = 0; row < rows; row++) spheres.set([row === 0 ? 0 : 50, 0, 0, 1], row * 4);
  runShadowPairs(...[spheres, params, volumeFloats, pairs, args, new Uint32Array(rows)].map(bytes));
  const kept = Array.from({ length: args[FRESH_ARG.pairs] }, (_, i) => picked[pairs[2 * i]]);
  fresh('sealShadowPages');
  const drawn = Array.from({ length: listed }, (_, p) => ({
    readable: (table[40 + p] & PAGE_VALID) !== 0,
    claimed: drawnBy[p] === DRAWN_GPU,
  }));
  const need = state[POOL_COUNTS.indexOf('pairs')];
  return { picked, kept, need, drawn, casters: args[freshDrawWord(0, FRESH_CASTERS) + 1] };
}

test('every listed page is drawn in the frame when the pairs it keeps fit, not only as many as hold every row', () => {
  // Each region keeps one row: six pairs in a list of seven, where a pair of every row of each
  // would have picked two pages.
  const { picked, kept, drawn, casters } = frame(7, () => [0]);
  assert.deepEqual(picked.sort(), [0, 1, 2, 3, 4, 5], 'every listed page picked');
  assert.equal(kept.length, 6, 'one pair a region');
  assert.equal(casters, 6, 'each layer draws the pairs kept');
  assert.deepEqual(drawn, Array(6).fill({ readable: true, claimed: true }), 'all readable');
});

test('an overflow of the pair list does not end in a coarser read', () => {
  // Every region keeps every row: eighteen pairs for a list of seven.
  const over = frame(7, () => [0, 1, 2]);
  assert.equal(over.picked.length, 6, 'every listed page picked');
  assert.equal(over.need, 18, 'the seal counts every pair every region asked');
  // Two regions admitted whole, six pairs: no region drawn short, none of its pairs wasted.
  assert.equal(over.casters, 6);
  const readable = over.picked.filter((p) => over.drawn[p].readable);
  assert.deepEqual([...new Set(over.kept)].sort(), readable.sort(), 'pairs of readable pages only');
  for (const p of readable)
    assert.equal(over.kept.filter((k) => k === p).length, 3, 'all its rows');
  for (const d of over.drawn) assert.equal(d.claimed, d.readable, 'a short page waits unclaimed');
  // The count read back grows the kept list (`growPairList`): the next frame draws them all.
  const grown = keptPairs(keptRows(3, over.need));
  assert.ok(grown >= 18, 'the list holds the need');
  const next = frame(grown, () => [0, 1, 2]);
  assert.deepEqual(
    next.drawn,
    Array(6).fill({ readable: true, claimed: true }),
    'every level drawn',
  );
  assert.equal(next.casters, 18);
});
