import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { mulberry32 } from '../../../../../site/examples/kit/random.ts';

// #924 (OMB-20): `sampledTileLighting` no longer keeps its weights in a private array: each loop
// recomputes the weight it reads. Both forms are ported here statement by statement, in f32,
// WGSL's comparisons included (any comparison with NaN is false): on random weights and the edge
// cases — NaN, ±0, ±Inf, all zero, one light heavy enough to be exact, a full list — they choose
// the same lights with the same factors, to the bit, so they shade the same pixel.

const f = Math.fround;
const SAMPLES = LIGHT_SETTINGS.samplesPerPixel,
  MAX = LIGHT_SETTINGS.tileLights;
type Choice = { chosen: number[]; factors: number[] } | 'none';

/** The sampler of before: the weights read once into an array, the exact ones zeroed in it. */
function withArray(weightOf: (i: number) => number, kept: number, offset: number): Choice {
  const weights: number[] = [];
  let total = 0;
  for (let i = 0; i < kept; i++) {
    weights[i] = weightOf(i);
    total = f(total + weights[i]);
  }
  if (total <= 0) return 'none';
  const chosen: number[] = [],
    factors: number[] = [];
  let pool = 0,
    last = 0;
  for (let i = 0; i < kept; i++) {
    if (f(weights[i] * SAMPLES) >= total) {
      chosen.push(i);
      factors.push(1);
      weights[i] = 0;
    } else if (weights[i] > 0) {
      pool = f(pool + weights[i]);
      last = i;
    }
  }
  const samples = SAMPLES - chosen.length;
  if (samples > 0 && pool > 0) {
    let running = 0,
      drawn = 0,
      next = f(f(offset / samples) * pool);
    for (let i = 0; i < kept && drawn < samples; i++) {
      const weight = weights[i];
      if (weight <= 0) continue;
      running = f(running + weight);
      while (drawn < samples && (next < running || i === last)) {
        chosen.push(i);
        factors.push(f(pool / f(samples * weight)));
        drawn++;
        next = f(f(f(drawn + offset) / samples) * pool);
      }
    }
  }
  return { chosen, factors };
}

/** The sampler now: `listedWeight` wherever a weight is read, `pooledWeight` for the pool's. */
function recomputed(weightOf: (i: number) => number, kept: number, offset: number): Choice {
  const pooled = (weight: number, total: number) => (f(weight * SAMPLES) >= total ? 0 : weight);
  let total = 0;
  for (let i = 0; i < kept; i++) total = f(total + weightOf(i));
  if (total <= 0) return 'none';
  const chosen: number[] = [];
  let pool = 0,
    last = 0;
  for (let i = 0; i < kept; i++) {
    const weight = weightOf(i);
    if (f(weight * SAMPLES) >= total) chosen.push(i);
    else if (weight > 0) {
      pool = f(pool + weight);
      last = i;
    }
  }
  const exact = chosen.length,
    samples = SAMPLES - exact;
  if (samples > 0 && pool > 0) {
    let running = 0,
      drawn = 0,
      next = f(f(offset / samples) * pool);
    for (let i = 0; i < kept && drawn < samples; i++) {
      const weight = pooled(weightOf(i), total);
      if (weight <= 0) continue;
      running = f(running + weight);
      while (drawn < samples && (next < running || i === last)) {
        chosen.push(i);
        drawn++;
        next = f(f(f(drawn + offset) / samples) * pool);
      }
    }
  }
  const factors = chosen.map((index, slot) =>
    slot < exact ? 1 : f(pool / f(samples * pooled(weightOf(index), total))),
  );
  return { chosen, factors };
}

const EDGE = [NaN, 0, -0, Infinity, -Infinity, 1e-45, 3.4e38, 1, 0.25];

test('recomputed weights choose the lights and factors of the weight array, to the bit', () => {
  const r = mulberry32(20);
  for (let run = 0; run < 5000; run++) {
    const kept = SAMPLES + 1 + Math.floor(r() * (MAX - SAMPLES));
    const edgy = run % 4 === 0,
      heavy = run % 3 === 0;
    const weights = [...Array(kept).keys()].map((i) => {
      if (edgy && r() < 0.2) return f(EDGE[Math.floor(r() * EDGE.length)]);
      if (r() < 0.2) return 0;
      return f(heavy && i % 17 === 3 ? r() * 1e4 : r() ** 3);
    });
    const offset = f(r());
    const weightOf = (i: number) => weights[i];
    assert.deepEqual(
      recomputed(weightOf, kept, offset),
      withArray(weightOf, kept, offset),
      `run ${run}`,
    );
  }
});

test('edge lists: all zero, one exact light, every light exact, a full list of equals', () => {
  const lists = [
    Array<number>(SAMPLES + 1).fill(0),
    [1e6, ...Array<number>(SAMPLES).fill(1)],
    Array<number>(SAMPLES + 1).fill(1),
    Array<number>(MAX).fill(0.5),
    [NaN, ...Array<number>(MAX - 1).fill(1)],
  ];
  for (const list of lists)
    for (const offset of [0, f(0.5), f(0.99999994)])
      assert.deepEqual(
        recomputed((i) => list[i], list.length, offset),
        withArray((i) => list[i], list.length, offset),
      );
});
