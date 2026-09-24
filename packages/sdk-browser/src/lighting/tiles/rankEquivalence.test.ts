import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { LIGHT_TILES_SHADER } from './shader.ts';
import {
  compactTile,
  tileLayout,
  tileLists,
} from '../../../../../bench/oracles/browser/gpuLightTilesRankOracle.ts';

// D4 and #28: shader.ts compacts each kept light at its rank (countOneBits, one thread per
// light), with room for every light the contract accepts. The oracle ports that compaction on
// the layout the shader declares, so a record too small for its lights fails here.

const layout = tileLayout(LIGHT_TILES_SHADER);
const MAX = LIGHT_SETTINGS.maxLights;

/** The workgroup mask: `opaque` and `blend` list the lights each slice keeps. */
function mask(opaque: Iterable<number>, blend: Iterable<number>) {
  const hits = new Uint32Array(2 * layout.words);
  for (const i of opaque) hits[layout.opaqueMask + (i >>> 5)] |= 1 << (i & 31);
  for (const i of blend) hits[layout.blendMask + (i >>> 5)] |= 1 << (i & 31);
  return hits;
}
const range = (n: number, keep = (_: number) => true) => [...Array(n).keys()].filter(keep);

test('the shader record has room for every light the contract accepts, in both lists', () => {
  assert.equal(layout.maxLights, MAX);
  assert.equal(layout.words, Math.ceil(MAX / 32));
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

test('a light count above the contract is clamped like the shader', () => {
  const tiles = compactTile(layout, mask(range(MAX), []), MAX + 7);
  assert.deepEqual(tileLists(layout, tiles).opaque, range(MAX));
});

test('fuzz: random masks and counts, any thread order gives the ascending list', () => {
  let seed = 7;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let trial = 0; trial < 40; trial++) {
    const count = 1 + Math.floor(rand() * MAX);
    const opaque = range(count, () => rand() < 0.5);
    const blend = range(count, () => rand() < 0.5);
    const lanes = range(layout.threads);
    for (let i = lanes.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }
    const inOrder = compactTile(layout, mask(opaque, blend), count);
    const shuffled = compactTile(layout, mask(opaque, blend), count, lanes);
    assert.deepEqual(shuffled, inOrder, `thread order changed the record at trial ${trial}`);
    assert.deepEqual(tileLists(layout, inOrder), { opaque, blend });
  }
});

test('the tile shader writes each kept light at its rank, with no guard on the rank', () => {
  assert.doesNotMatch(LIGHT_TILES_SHADER, /MAX_TILE_LIGHTS/, 'no per-tile ceiling');
  // The oracle clamps the count to MAX_LIGHTS only; a lower clamp here drops lights unseen.
  assert.match(LIGHT_TILES_SHADER, /let count=min\(lights\.count,MAX_LIGHTS\);/);
  for (const slice of ['OPAQUE', 'BLEND'])
    assert.match(
      LIGHT_TILES_SHADER,
      new RegExp(
        `if\\(lane<count&&maskHolds\\(${slice}_MASK,lane\\)\\)\\{\\n` +
          ` {2}tiles\\[base\\+TILE_${slice}_BASE\\+rankBefore\\(${slice}_MASK,lane\\)\\]=lane;\\n \\}`,
      ),
    );
  assert.match(LIGHT_TILES_SHADER, /tiles\[base\]=maskTotal\(OPAQUE_MASK\);/);
  assert.match(LIGHT_TILES_SHADER, /tiles\[base\+1u\]=maskTotal\(BLEND_MASK\);/);
});
