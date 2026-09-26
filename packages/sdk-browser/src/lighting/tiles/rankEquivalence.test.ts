import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneLightCapacity } from '../../../../sdk-core/src/index.ts';
import { LIGHT_TILES_SHADER } from './shader.ts';
import {
  compactTile,
  tileLayout,
  tileLists,
} from '../../../../../bench/oracles/browser/gpuLightTilesRankOracle.ts';
import {
  sphereTouchesColumn,
  tileColumn,
  tileCorner,
} from '../../../../../bench/oracles/browser/gpuLightTileColumnOracle.ts';
import { view } from './tileView.fixture.ts';

// D4, #28 and #822: shader.ts tests the scene's lights 256 at a time, one per thread, and compacts
// each kept light at what the batches before kept plus its rank (countOneBits), with room for
// every slot of the light table. The oracle ports that compaction on the layout the shader
// declares, so a record too small for its lights fails here.

const MAX = sceneLightCapacity(64);
const layout = tileLayout(LIGHT_TILES_SHADER, MAX);
const range = (n: number, keep = (_: number) => true) => [...Array(n).keys()].filter(keep);

test('the shader record has room for every slot of the light table, in both lists', () => {
  for (const capacity of [MAX, sceneLightCapacity(300)]) {
    const grown = tileLayout(LIGHT_TILES_SHADER, capacity);
    assert.ok(grown.blendBase - grown.opaqueBase >= capacity, 'opaque list room');
    assert.ok(grown.stride - grown.blendBase >= capacity, 'blend list room');
  }
  assert.equal(layout.words * 32, layout.threads, 'one mask bit per thread of a batch');
});

test('0 lights: empty lists', () => {
  const tiles = compactTile(layout, { opaque: [], blend: [] }, 0);
  assert.deepEqual(tileLists(layout, tiles), { opaque: [], blend: [] });
});

test('every declared light touching one tile is kept, in order, none dropped', () => {
  const tiles = compactTile(layout, { opaque: range(MAX), blend: range(MAX) }, MAX);
  assert.deepEqual([tiles[0], tiles[1]], [MAX, MAX]);
  assert.deepEqual(tileLists(layout, tiles), { opaque: range(MAX), blend: range(MAX) });
});

test('holey mask: every other light retained, including across the 32-bit word boundary', () => {
  const even = range(MAX, (i) => i % 2 === 0);
  const odd = range(MAX, (i) => i % 2 === 1);
  const tiles = compactTile(layout, { opaque: even, blend: odd }, MAX);
  assert.deepEqual(tileLists(layout, tiles), { opaque: even, blend: odd });
});

test('a light at or beyond the count is never written', () => {
  // The shader's `index<count` guard keeps such a bit unset; the compaction ignores it anyway.
  const tiles = compactTile(layout, { opaque: [0, 5], blend: [5] }, 3);
  assert.equal(tiles[layout.opaqueBase], 0);
  assert.ok(!tiles.includes(5), 'light 5 written');
});

test('fuzz: random keeps, counts past a batch and thread orders give the ascending list', () => {
  let seed = 7;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let trial = 0; trial < 40; trial++) {
    const count = 1 + Math.floor(rand() * 600);
    const grown = tileLayout(LIGHT_TILES_SHADER, sceneLightCapacity(count));
    const keeps = {
      opaque: range(count, () => rand() < 0.5),
      blend: range(count, () => rand() < 0.5),
    };
    const lanes = range(grown.threads);
    for (let i = lanes.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }
    const inOrder = compactTile(grown, keeps, count);
    assert.deepEqual(compactTile(grown, keeps, count, lanes), inOrder, `trial ${trial}`);
    assert.deepEqual(tileLists(grown, inOrder), keeps);
  }
});

test('300 lights in a sky tile: its blend list is the CPU culling of every one of them', () => {
  const v = view([0, 0, 0]),
    tile: [number, number] = [37, 21],
    column = tileColumn(v, tile);
  // A lamp every metre down the tile's axis, every other one pushed sideways out of its column.
  const corner = [0, 1, 2, 3].map((c) => tileCorner(v, tile, c, 1)),
    axis = [0, 1, 2].map((a) => corner.reduce((sum, p) => sum + p[a], 0)),
    unit = axis.map((x) => x / Math.hypot(...axis));
  const lamps = range(300).map((i) => ({
    centre: unit.map((x, a) => x * (1 + i) + (a === 0 ? (i % 2) * 0.1 * (1 + i) : 0)) as [
      number,
      number,
      number,
    ],
    radius: 0.002 * (1 + i),
  }));
  const blend = range(300, (i) => sphereTouchesColumn(column, lamps[i].centre, lamps[i].radius));
  assert.ok(blend.length > 0 && blend.length < 300, 'the fixture keeps some lamps, not all');
  assert.ok(
    blend.some((i) => i >= 256),
    'a lamp past the first batch is kept',
  );
  const grown = tileLayout(LIGHT_TILES_SHADER, sceneLightCapacity(300));
  const tiles = compactTile(grown, { opaque: [], blend }, 300);
  assert.deepEqual(tileLists(grown, tiles), { opaque: [], blend });
});

test('the tile shader writes each kept light after the batches before it, with no guard on the rank', () => {
  assert.doesNotMatch(LIGHT_TILES_SHADER, /MAX_LIGHTS|MAX_TILE_LIGHTS/, 'no light ceiling');
  assert.match(LIGHT_TILES_SHADER, /let count=workgroupUniformLoad\(&lightCount\);/);
  assert.match(LIGHT_TILES_SHADER, /for\(var first=0u;first<count;first\+=256u\)\{/);
  for (const [slice, base, kept] of [
    ['OPAQUE', 'TILE_OPAQUE_BASE', 'opaqueKept'],
    ['BLEND', 'tileBlendBase\\(capacity\\)', 'blendKept'],
  ])
    assert.match(
      LIGHT_TILES_SHADER,
      new RegExp(
        `if\\(index<count&&maskHolds\\(${slice}_MASK,lane\\)\\)\\{\\n` +
          ` {3}tiles\\[base\\+${base}\\+${kept}\\+rankBefore\\(${slice}_MASK,lane\\)\\]=index;\\n {2}\\}`,
      ),
    );
  assert.match(LIGHT_TILES_SHADER, /tiles\[base\]=opaqueKept;/);
  assert.match(LIGHT_TILES_SHADER, /tiles\[base\+1u\]=blendKept;/);
});
