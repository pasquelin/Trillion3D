import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneLightCapacity } from '../../../../sdk-core/src/index.ts';
import { LIGHT_TILES_SHADER } from './shader.ts';
import {
  compactTile,
  tileLayout,
  tileLists,
} from '../../../../../bench/oracles/browser/gpuLightTilesRankOracle.ts';

// D4, #28 and #822: shader.ts compacts each kept light at its rank (countOneBits, one thread per
// light, 256 lights a batch), with room for every slot of the light table. The oracle ports that
// compaction on the layout the shader declares, so a record too small for its lights fails here.

const MAX = sceneLightCapacity(64);
const layout = tileLayout(LIGHT_TILES_SHADER, MAX);

/** What each slice keeps: `opaque` and `blend` list the lights by rank. */
const mask = (opaque: Iterable<number>, blend: Iterable<number>) => ({ opaque, blend });
const range = (n: number, keep = (_: number) => true) => [...Array(n).keys()].filter(keep);

test('the shader record has room for every slot of the light table, in both lists', () => {
  assert.equal(layout.words * 32, layout.threads, 'one mask bit per thread of a batch');
  assert.ok(layout.blendBase - layout.opaqueBase >= MAX, 'opaque list room');
  assert.ok(layout.stride - layout.blendBase >= MAX, 'blend list room');
});

test('0 lights: empty lists', () => {
  const tiles = compactTile(layout, mask([], []), 0);
  assert.deepEqual(tileLists(layout, tiles), { opaque: [], blend: [] });
});

test('all masks zero, count at the scene lights ceiling', () => {
  const tiles = compactTile(layout, mask([], []), MAX);
  assert.deepEqual(tileLists(layout, tiles), { opaque: [], blend: [] });
});

test('every declared light touching one tile is kept, in order, none dropped', () => {
  const tiles = compactTile(layout, mask(range(MAX), range(MAX)), MAX);
  assert.deepEqual([tiles[0], tiles[1]], [MAX, MAX]);
  assert.deepEqual(tileLists(layout, tiles), { opaque: range(MAX), blend: range(MAX) });
});

test('more than 32 lights in one tile: all of them contribute', () => {
  const tiles = compactTile(layout, mask(range(33), range(40)), MAX);
  assert.deepEqual(tileLists(layout, tiles), { opaque: range(33), blend: range(40) });
});

test('holey mask: every other light retained, including across the 32-bit word boundary', () => {
  const even = range(MAX, (i) => i % 2 === 0);
  const odd = range(MAX, (i) => i % 2 === 1);
  const tiles = compactTile(layout, mask(even, odd), MAX);
  assert.deepEqual(tileLists(layout, tiles), { opaque: even, blend: odd });
});

test('isolated bit at word boundary (31 and 32)', () => {
  const tiles = compactTile(layout, mask([31, 32], [32]), MAX);
  assert.deepEqual(tileLists(layout, tiles), { opaque: [31, 32], blend: [32] });
});

test('a light at or beyond the count is never written', () => {
  // The shader's `lane<count` guard keeps such a bit unset; the compaction ignores it anyway.
  const tiles = compactTile(layout, mask([0, 5], [5]), 3);
  assert.equal(tiles[layout.opaqueBase], 0);
  assert.ok(!tiles.includes(5), 'light 5 written');
});

test('300 lights touching one tile: every one kept, in order, across batches (#822)', () => {
  const grown = tileLayout(LIGHT_TILES_SHADER, sceneLightCapacity(300));
  const tiles = compactTile(
    grown,
    mask(
      range(300),
      range(300, (i) => i % 3 === 0),
    ),
    300,
  );
  assert.deepEqual(tileLists(grown, tiles), {
    opaque: range(300),
    blend: range(300, (i) => i % 3 === 0),
  });
});

test('fuzz: random masks and counts, any thread order gives the ascending list', () => {
  let seed = 7;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let trial = 0; trial < 40; trial++) {
    const count = 1 + Math.floor(rand() * 600);
    const grown = tileLayout(LIGHT_TILES_SHADER, sceneLightCapacity(count));
    const opaque = range(count, () => rand() < 0.5);
    const blend = range(count, () => rand() < 0.5);
    const lanes = range(grown.threads);
    for (let i = lanes.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }
    const inOrder = compactTile(grown, mask(opaque, blend), count);
    const shuffled = compactTile(grown, mask(opaque, blend), count, lanes);
    assert.deepEqual(shuffled, inOrder, `thread order changed the record at trial ${trial}`);
    assert.deepEqual(tileLists(grown, inOrder), { opaque, blend });
  }
});

test('the tile shader writes each kept light at its rank, after the batches before it', () => {
  assert.doesNotMatch(LIGHT_TILES_SHADER, /MAX_LIGHTS|MAX_TILE_LIGHTS/, 'no light ceiling');
  // Every light is tested: the batch loop runs to the scene's count, uniform for the workgroup.
  assert.match(LIGHT_TILES_SHADER, /let count=workgroupUniformLoad\(&lightCount\);/);
  assert.match(LIGHT_TILES_SHADER, /for\(var first=0u;first<count;first\+=256u\)\{/);
  for (const [slice, base, kept] of [
    ['OPAQUE', 'TILE_OPAQUE_BASE', 'x'],
    ['BLEND', 'tileBlendBase\\(lights\\.capacity\\)', 'y'],
  ])
    assert.match(
      LIGHT_TILES_SHADER,
      new RegExp(
        `if\\(index<count&&maskHolds\\(${slice}_MASK,lane\\)\\)\\{\\n` +
          ` {2}tiles\\[base\\+${base}\\+kept\\.${kept}\\+rankBefore\\(${slice}_MASK,lane\\)\\]=index;\\n \\}`,
      ),
    );
  assert.match(
    LIGHT_TILES_SHADER,
    /if\(lane==0u\)\{tiles\[base\]=kept\.x;tiles\[base\+1u\]=kept\.y;\}/,
  );
});
