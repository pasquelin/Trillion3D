import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { LIGHT_TILES_NARROW_SHADER, LIGHT_TILES_SHADER } from './shader.ts';
import {
  compactTile,
  tileLayout,
  tileLists,
} from '../../../../../bench/oracles/browser/gpuLightTilesRankOracle.ts';

// D4, #28, #822 and #849: shader.ts compacts each kept light at its rank (countOneBits, one thread
// per light, 256 lights a batch) into lists of `tileLights`, and a slice past its list into the
// view's pool. The oracle ports that compaction on the layout the shader declares, so a record
// too small for its lights fails here.

const layout = tileLayout(LIGHT_TILES_SHADER);
const MAX = LIGHT_SETTINGS.tileLights;

/** What each slice keeps: `opaque` and `blend` list the lights by rank. */
const mask = (opaque: Iterable<number>, blend: Iterable<number>) => ({ opaque, blend });
const range = (n: number, keep = (_: number) => true) => [...Array(n).keys()].filter(keep);

test('the shader record has room for a list of tileLights, in both lists', () => {
  assert.equal(layout.tileLights, MAX);
  assert.equal(layout.words * 32, layout.threads, 'one mask bit per thread of a batch');
  assert.ok(layout.blendBase - layout.opaqueBase >= MAX, 'opaque list room');
  assert.ok(layout.stride - layout.blendBase >= MAX, 'blend list room');
});

test('0 lights: empty lists', () => {
  const tiles = compactTile(layout, mask([], []), 0);
  assert.deepEqual(tileLists(layout, tiles, MAX), { opaque: [], blend: [] });
});

test('all masks zero, count at the scene lights ceiling', () => {
  const tiles = compactTile(layout, mask([], []), MAX);
  assert.deepEqual(tileLists(layout, tiles, MAX), { opaque: [], blend: [] });
});

test('every declared light touching one tile is kept, in order, none dropped', () => {
  const tiles = compactTile(layout, mask(range(MAX), range(MAX)), MAX);
  assert.deepEqual([tiles[0], tiles[1]], [MAX, MAX]);
  assert.deepEqual(tileLists(layout, tiles, MAX), { opaque: range(MAX), blend: range(MAX) });
});

test('more than 32 lights in one tile: all of them contribute', () => {
  const tiles = compactTile(layout, mask(range(33), range(40)), MAX);
  assert.deepEqual(tileLists(layout, tiles, MAX), { opaque: range(33), blend: range(40) });
});

test('holey mask: every other light retained, including across the 32-bit word boundary', () => {
  const even = range(MAX, (i) => i % 2 === 0);
  const odd = range(MAX, (i) => i % 2 === 1);
  const tiles = compactTile(layout, mask(even, odd), MAX);
  assert.deepEqual(tileLists(layout, tiles, MAX), { opaque: even, blend: odd });
});

test('isolated bit at word boundary (31 and 32)', () => {
  const tiles = compactTile(layout, mask([31, 32], [32]), MAX);
  assert.deepEqual(tileLists(layout, tiles, MAX), { opaque: [31, 32], blend: [32] });
});

test('a light at or beyond the count is never written', () => {
  // The shader's `lane<count` guard keeps such a bit unset; the compaction ignores it anyway.
  const tiles = compactTile(layout, mask([0, 5], [5]), 3);
  assert.equal(tiles[layout.opaqueBase], 0);
  assert.ok(!tiles.includes(5), 'light 5 written');
});

/** A pool with room for `capacity` indices, nothing reserved yet. */
const roomFor = (capacity: number) => ({ capacity, head: 0, overflow: 0 });

test('a tile more than tileLights lights reach reads exactly those, in order (#849)', () => {
  // 600 scene lights, 150 of them reach the opaque slice across three batches, 64 the blend one.
  const opaque = range(600, (i) => i % 4 === 1);
  const blend = range(600, (i) => i % 9 === 0).slice(0, MAX);
  const pool = roomFor(1000);
  const tiles = compactTile(layout, mask(opaque, blend), 600, undefined, pool);
  assert.deepEqual([tiles[0], tiles[1]], [opaque.length, MAX]);
  assert.deepEqual(tileLists(layout, tiles, 600), { opaque, blend });
  assert.deepEqual(pool, { capacity: 1000, head: opaque.length, overflow: 0 });
});

test('a pool with no room left raises its overflow, and that tile walks every light (#849)', () => {
  const opaque = range(300, (i) => i % 2 === 0);
  const blend = range(100);
  // Room for the opaque slice alone: the blend one, reserved after it, overflows.
  const pool = roomFor(opaque.length);
  const tiles = compactTile(layout, mask(opaque, blend), 300, undefined, pool);
  assert.equal(pool.overflow, 1, 'the overflow is raised');
  assert.equal(tiles[layout.blendBase], layout.noSlice);
  assert.deepEqual(tileLists(layout, tiles, 300), { opaque, blend: range(300) });
  // No pool at all: both slices walk every light, never a truncated list.
  const none = roomFor(0);
  const bare = compactTile(layout, mask(opaque, blend), 300, undefined, none);
  assert.equal(none.overflow, 1);
  assert.deepEqual(tileLists(layout, bare, 300), { opaque: range(300), blend: range(300) });
  // A count of what was asked near the word's end never wraps back into room.
  const worn = { capacity: 1000, head: 0x80000000, overflow: 0 };
  const late = compactTile(layout, mask(opaque, blend), 300, undefined, worn);
  assert.deepEqual([worn.overflow, worn.head], [1, 0x80000000]);
  assert.deepEqual(tileLists(layout, late, 300), { opaque: range(300), blend: range(300) });
});

test('fuzz: random masks and counts, any thread order gives the ascending list', () => {
  let seed = 7;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let trial = 0; trial < 40; trial++) {
    const count = 1 + Math.floor(rand() * 600);
    const opaque = range(count, () => rand() < 0.1);
    const blend = range(count, () => rand() < 0.1);
    const lanes = range(layout.threads);
    for (let i = lanes.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }
    const inOrder = compactTile(layout, mask(opaque, blend), count, undefined, roomFor(2 * count));
    const shuffled = compactTile(layout, mask(opaque, blend), count, lanes, roomFor(2 * count));
    assert.deepEqual(shuffled, inOrder, `thread order changed the record at trial ${trial}`);
    assert.deepEqual(tileLists(layout, inOrder, count), { opaque, blend });
  }
});

test('the tile shader writes each kept light at its rank, after the batches before it', () => {
  assert.doesNotMatch(LIGHT_TILES_SHADER, /MAX_LIGHTS|MAX_TILE_LIGHTS/, 'no light ceiling');
  // Every light is tested: the batch loop runs to the scene's count, uniform for the workgroup.
  assert.match(LIGHT_TILES_SHADER, /let count=workgroupUniformLoad\(&lightCount\);/);
  assert.match(LIGHT_TILES_SHADER, /for\(var first=0u;first<count;first\+=256u\)\{/);
  for (const [slice, kept] of [
    ['OPAQUE', 'x'],
    ['BLEND', 'y'],
  ])
    assert.ok(
      LIGHT_TILES_SHADER.includes(
        `if(index<count&&maskHolds(${slice}_MASK,lane)){let at=kept.${kept}+rankBefore(${slice}_MASK,lane);` +
          `if(at<room.${kept}){tiles[start.${kept}+at]=index;}}`,
      ),
      `${slice} list written at its rank after the batches before, within its room`,
    );
  // A slice past its list reserves its room in the pool, or raises the overflow.
  assert.match(
    LIGHT_TILES_SHADER,
    /if\(atomicLoad\(&pool\.head\)<0x80000000u\)\{at=atomicAdd\(&pool\.head,total\);\}/,
  );
  assert.match(LIGHT_TILES_SHADER, /else\{atomicStore\(&pool\.overflow,1u\);\}/);
});

test('the narrow pass: masks and light array of one list, no pool (#849)', () => {
  const narrow = tileLayout(LIGHT_TILES_NARROW_SHADER);
  assert.equal(narrow.words * 32, MAX, 'one mask bit per light of a list');
  assert.match(LIGHT_TILES_NARROW_SHADER, new RegExp(`items:array<DirectLight,${MAX}>`));
  assert.match(LIGHT_TILES_NARROW_SHADER, /lightCount=min\(lights\.count,TILE_LIGHTS\);/);
  assert.doesNotMatch(
    LIGHT_TILES_NARROW_SHADER,
    /var<storage,read_write> pool|counted|storageBarrier/,
  );
  // One batch, written straight at its rank: no batch loop, no room to track (#822's shape).
  assert.doesNotMatch(
    LIGHT_TILES_NARROW_SHADER,
    /for\(var first=|var<workgroup> (kept|start|room)/,
  );
  assert.match(
    LIGHT_TILES_NARROW_SHADER,
    /tiles\[base\+TILE_OPAQUE_BASE\+rankBefore\(OPAQUE_MASK,lane\)\]=lane;/,
  );
  // Its record is the wide pass's: the resolve reads either.
  assert.deepEqual({ ...narrow, words: 0, blendMask: 0 }, { ...layout, words: 0, blendMask: 0 });
  // Up to tileLights lights, one batch: the lists of the wide pass, bit for bit.
  const opaque = range(MAX, (i) => i % 3 === 0),
    blend = range(MAX, (i) => i % 5 !== 0);
  assert.deepEqual(
    compactTile(narrow, mask(opaque, blend), MAX),
    compactTile(layout, mask(opaque, blend), MAX),
  );
});

/** Waits of the pass up to its second walk, a batch after the first not counted. */
const firstWalkWaits = (shader: string) =>
  shader
    .slice(shader.indexOf('fn walkLights('))
    .split('if(max(total.x,total.y)>TILE_LIGHTS)')[0]
    .split('\n')
    .filter((line) => !/if\(first\+\d+u<count\)/.test(line))
    .join('\n')
    .match(/workgroupBarrier\(\)|workgroupUniformLoad\(|storageBarrier\(\)/g)?.length;

test('one batch, one walk: the narrow pass waits at five barriers, the wide one at six (#849)', () => {
  // Init, depth, corners (#924), bounds and tests, each behind one barrier, as before the
  // batches; the wide pass hands the true counts to every thread once more.
  assert.equal(firstWalkWaits(LIGHT_TILES_NARROW_SHADER), 5);
  assert.equal(firstWalkWaits(LIGHT_TILES_SHADER), 6);
});
