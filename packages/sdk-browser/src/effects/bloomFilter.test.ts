// The physically based bloom (#349): the engine's filters are the published ones, the chain of
// levels conserves energy with no threshold, and its targets are sized from the image alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOOM_DOWN_TAPS,
  BLOOM_LEVELS,
  BLOOM_UP_TAPS,
  bloomBlend,
  bloomLevelBytes,
  bloomLevelSizes,
} from './bloomFilter.ts';
import { cpuBloom, publishedDownTaps, publishedUpTaps, tapWords } from './bloom.fixture.ts';

test('the down and up taps are the published 13-tap filter and 3×3 tent, each of weight 1', () => {
  assert.deepEqual(tapWords(BLOOM_DOWN_TAPS), tapWords(publishedDownTaps()));
  assert.deepEqual(tapWords(BLOOM_UP_TAPS), tapWords(publishedUpTaps()));
  for (const taps of [BLOOM_DOWN_TAPS, BLOOM_UP_TAPS])
    assert.equal(
      taps.reduce((sum, [, , weight]) => sum + weight, 0),
      1,
    );
});

/** A dark image with one bright pixel near its centre, far enough from the edges that no level's
 *  footprint reaches them: what the clamp at the edge would otherwise fold back is nothing. */
function impulse(size: number, radiance: number) {
  const data = new Float64Array(size * size);
  data[(size / 2) * size + size / 2 + 3] = radiance;
  return { data, w: size, h: size };
}
const total = (data: Float64Array) => data.reduce((sum, value) => sum + value, 0);

test('with no threshold the whole chain conserves energy: the glow spreads light, it adds none', () => {
  const source = impulse(1024, 1000);
  for (const [intensity, radius] of [
    [0.04, 1],
    [1, 1],
    [0.5, 1.5],
  ]) {
    const out = cpuBloom(source, intensity, radius, BLOOM_DOWN_TAPS, BLOOM_UP_TAPS);
    assert.ok(
      Math.abs(total(out.data) - 1000) < 1e-9 * 1000,
      `intensity ${intensity}, radius ${radius}: ${total(out.data)}`,
    );
    const centre = (source.w / 2) * source.w + source.w / 2 + 3;
    assert.ok(out.data[centre] < 1000, 'the bright pixel gave some of its light away');
    if (intensity > 0.04) assert.ok(out.data[centre + 40] > 0, 'and its neighbours received it');
  }
});

test('a uniform image is left as it is, whatever the blend', () => {
  const data = new Float64Array(64 * 48).fill(2.5);
  const out = cpuBloom({ data, w: 64, h: 48 }, 0.7, 1, BLOOM_DOWN_TAPS, BLOOM_UP_TAPS);
  for (const value of out.data) assert.ok(Math.abs(value - 2.5) < 1e-12);
});

test('levels halve the image six times at most, never under one texel, and count their bytes', () => {
  assert.equal(BLOOM_LEVELS, 6);
  assert.deepEqual(bloomLevelSizes(1920, 1080), [
    [960, 540],
    [480, 270],
    [240, 135],
    [120, 67],
    [60, 33],
    [30, 16],
  ]);
  assert.deepEqual(bloomLevelSizes(9, 5), [
    [4, 2],
    [2, 1],
  ]);
  assert.deepEqual(bloomLevelSizes(1, 1), []);
  assert.equal(bloomLevelBytes(9, 5), (8 + 2) * 8);
  assert.deepEqual(bloomBlend(0.04, 6), { keep: 0.96, glow: 0.04 / 6 });
  assert.deepEqual(bloomBlend(0.5, 0), { keep: 0.5, glow: 0 });
});
