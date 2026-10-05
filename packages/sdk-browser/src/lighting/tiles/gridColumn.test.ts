// S19.4: a column of the light grid marks a run holding every slice — a sun's — by one lane bit,
// and deals its room out by a scan over its 64 lanes, never by two walks of its 256 slices on lane
// zero. Everything is an integer: on random series — full depth, more lights than lanes and than
// the cache holds, pools that overflow or stand past half the word — the shipped routines give
// the serial column's counts, cursors, lists and overflow flag, column after column.
import test from 'node:test';
import assert from 'node:assert/strict';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import {
  CACHE,
  GRID_SLICES,
  LANES,
  serialColumn,
  shippedColumn,
  suns,
  type Pool,
  type Run,
} from './gridColumn.fixture.ts';
import { GRID_COMPACT_WGSL } from './compactWgsl.ts';
import { LIGHT_TILES_SHADER } from './shader.ts';

/** `count` lights of a column: a share full depth, a share meeting no cell, the others a run. */
function series(seed: number, count: number, full: number, none: number): Run[] {
  const r = random(seed),
    slice = () => Math.floor(r() * GRID_SLICES);
  return Array.from({ length: count }, () => {
    const pick = r(),
      slot = r() < 0.3;
    if (pick < full) return { first: 0, last: GRID_SLICES - 1, slot };
    if (pick < full + none) return null;
    const [a, b] = [slice(), slice()];
    // Short runs mostly, as a lamp's across a doubling of the depth; some long ones.
    const last = r() < 0.7 ? Math.min(GRID_SLICES - 1, a + Math.floor(r() * 16)) : Math.max(a, b);
    return { first: Math.min(a, last), last, slot };
  });
}

/** Columns `columns` in one pool, shipped and serial: the same records, lists and pool. */
function same(columns: Run[][], pool: Pool) {
  const shipped = { ...pool },
    serial = { ...pool };
  columns.forEach((runs, i) => {
    const got = shippedColumn(runs, shipped),
      want = serialColumn(runs, serial);
    assert.deepEqual(got.counts, want.counts, `column ${i}: counts`);
    assert.deepEqual(got.cursor, want.cursor, `column ${i}: cursors`);
    assert.deepEqual([...got.words].sort(byAt), [...want.words].sort(byAt), `column ${i}: lists`);
    assert.deepEqual(shipped, serial, `column ${i}: pool`);
  });
  return shipped;
}
const byAt = (a: [number, number], b: [number, number]) => a[0] - b[0];

test('random columns: the counts, cursors, lists and pool of the serial column', () => {
  for (let seed = 1; seed <= 24; seed++) {
    const r = random(seed * 7919);
    const columns = [0, 1, 2].map((k) =>
      series(seed * 3 + k, Math.floor(r() * (seed % 4 === 0 ? 900 : 200)), r() * 0.3, r() * 0.4),
    );
    // The pool: roomy, tight, or full from the start.
    const capacity = [1 << 20, Math.floor(r() * 4000), 0][seed % 3];
    same(columns, { start: 1000 + seed, capacity, head: Math.floor(r() * 50), overflow: 0 });
  }
});

test('full depth: every light a sun, past the lanes and the cache', () => {
  const roomy = (head: number): Pool => ({ start: 7, capacity: 1 << 22, head, overflow: 0 });
  same([suns(1), suns(LANES + 1), suns(CACHE + LANES + 3)], roomy(0));
  // Its lane bit stands for every slice: no slice's mask is ever marked.
  assert.equal(shippedColumn(suns(CACHE + LANES + 3), roomy(0)).marks, 0);
  assert.equal(shippedColumn([{ first: 2, last: 4, slot: false }], roomy(0)).marks, 3 * 2);
  // A sun, then lights that leave its lane: its bit is cleared, its slices not marked again.
  const mixed: Run[] = [
    ...suns(LANES),
    ...Array.from({ length: LANES }, (_, i) =>
      i % 2 ? null : { first: i, last: i + 3, slot: false },
    ),
    ...suns(5),
  ];
  same([mixed, [], mixed], roomy(3));
});

test('overflow: a column past the pool walks every light, a head past half the word takes none', () => {
  const runs = series(5, 150, 0.1, 0.2);
  const tight = same([runs, runs, []], { start: 64, capacity: 2000, head: 0, overflow: 0 });
  assert.equal(tight.overflow, 1);
  const past = same([runs], { start: 64, capacity: 2000, head: 0x80000000, overflow: 0 });
  assert.deepEqual([past.head, past.overflow], [0x80000000, 1]);
});

test('the pass is the routines the harness runs, in its order', () => {
  assert.match(GRID_COMPACT_WGSL, /laneScan\(lane,sum\)-sum/);
  assert.doesNotMatch(GRID_COMPACT_WGSL, /for\(var slice=0u;slice<GRID_SLICES;slice\+\+\)/);
  const between = [
    'let span=laneRun(lane,GRID_SLICES);',
    'let before=roomBefore(lane,span);',
    'if(lane==0u){takeRoom();walked.y=cached;walked.z=select(resume,count,resume==ALL_CACHED);}',
    'let walk=workgroupUniformLoad(&walked);',
    'dealRoom(span,before,walk.w);',
  ];
  assert.ok(LIGHT_TILES_SHADER.includes(between.join('\n ')));
});
