import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { erode, EROSION_CELL, SHORE } from './erosion.ts';
import { fbm } from './noise.ts';

const SIDE = 129;

/** A hilly island: fractal relief rising from a sea along the grid's south rows. */
function island(seed: number) {
  const heights = new Float32Array(SIDE * SIDE);
  for (let j = 0; j < SIDE; j++)
    for (let i = 0; i < SIDE; i++)
      heights[j * SIDE + i] =
        12 * (SIDE * 0.8 - j) +
        400 * fbm(seed, i / 24, j / 24, 5) +
        150 * fbm(seed + 1, i / 5, j / 5, 2);
  return heights;
}

/** Root mean square of each land cell's height against its four neighbours' mean. */
function roughness(heights: Float32Array) {
  let sum = 0,
    count = 0;
  for (let j = 1; j < SIDE - 1; j++)
    for (let i = 1; i < SIDE - 1; i++) {
      const c = j * SIDE + i;
      if (heights[c] <= 0) continue;
      const mean = (heights[c - 1] + heights[c + 1] + heights[c - SIDE] + heights[c + SIDE]) / 4;
      sum += (heights[c] - mean) ** 2;
      count++;
    }
  return Math.sqrt(sum / count);
}

describe('open world erosion', () => {
  const heights = island(7),
    eroded = erode(heights, SIDE, EROSION_CELL);
  it('erodes the same grid into the same bytes', () => {
    const again = erode(island(7), SIDE, EROSION_CELL);
    for (const key of ['bed', 'rock', 'wet'] as const)
      assert.deepEqual(new Uint8Array(again[key].buffer), new Uint8Array(eroded[key].buffer), key);
  });
  it('wears the ridge-to-valley noise down', () => {
    const before = roughness(heights),
      after = roughness(eroded.bed);
    assert.ok(after < before * 0.9, `roughness ${before.toFixed(2)} m → ${after.toFixed(2)} m`);
  });
  it('leaves the sea as it was and never lowers land to the shore', () => {
    let moved = 0;
    heights.forEach((h, c) => {
      const bed = eroded.bed[c];
      if (h <= 0) assert.equal(bed, h, `sea cell ${c}`);
      else assert.ok(bed >= Math.min(h, SHORE), `land cell ${c}: ${h} → ${bed}`);
      assert.ok(eroded.rock[c] <= bed && eroded.wet[c] >= 0 && eroded.wet[c] <= 1);
      if (Math.abs(bed - h) > 1) moved++;
    });
    assert.ok(moved > heights.length / 10, `${moved} cells moved by more than a metre`);
  });
  it('gathers water along the valleys, so a few cells carry most of it', () => {
    const wet = [...eroded.wet].sort((a, b) => a - b),
      median = wet[wet.length >> 1],
      high = wet[Math.floor(wet.length * 0.99)];
    assert.ok(high > 4 * median, `median ${median}, 99th percentile ${high}`);
  });
});
