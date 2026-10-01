import test from 'node:test';
import assert from 'node:assert/strict';
import { REFLECTION_STILL_FRAMES } from './resolveWgsl.ts';
import { historyConfidence } from './historyFrame.ts';
import { fixture } from './resolveWgsl.fixture.ts';

/** Moving, the history short and clipped, the resolved roof's frame-to-frame deviation stays under
 *  this share of its mean (#831): one stochastic ray per 2 × 2 block, each a reflection of 1 at
 *  0.5 or 1.5, reached the image at 0.19 of the mean before the spatial filter widened, 0.10 after. */
const MOVING_DEVIATION = 0.15;
const FRAMES = 240,
  WARM = 40;

/** A seeded uniform draw in [0, 1): the same noise for every run compared. */
function draws(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** drive-a-car's roof (#831): a glossy receiver (roughness 0.1) on one plane of a 16 × 16 image,
 *  every half-resolution texel traced each frame with one noisy ray; the resolved pixel (4, 4)
 *  fed back as its own history. `moving` is the driving case: sources and camera moving, no live
 *  motion, the history at the change cap (`historyRuntime.ts`). */
function resolved(moving: boolean, roughness: number, constants: Record<string, number> = {}) {
  const f = fixture(constants);
  const random = draws(831);
  f.view.viewport = [16, 16, 1 / 16, 1 / 16];
  f.traced.length = 0;
  for (let k = 0; k < 64; k++) f.traced.push([k & 7, k >> 3]);
  f.samples.normalRough = f.samples.previousNormal = [0, 0, 1, roughness];
  f.samples.historyColor = [1, 1, 1, REFLECTION_STILL_FRAMES];
  f.view.clip[0] = moving ? 1 : 0;
  f.view.params[1] = moving ? historyConfidence(false, 0) : REFLECTION_STILL_FRAMES;
  const out: number[][] = [];
  for (let frame = 0; frame < FRAMES; frame++) {
    const rays = Array.from({ length: 64 }, () => (random() < 0.5 ? 0.5 : 1.5));
    f.samples.sampleColor = (at: number[]) => {
      const value = rays[at[0] + 8 * at[1]];
      return [value, value, value, 1];
    };
    f.view.params[3] = frame & 3;
    out.push((f.samples.historyColor = f.resolve()));
  }
  return out;
}

function deviation(frames: number[][]) {
  const values = frames.slice(WARM).map((value) => value[0]);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return { mean, deviation: Math.sqrt(variance) };
}

test('#831: moving, a short or clipped history widens the spatial filter: the glossy roof stays quiet', () => {
  const widened = deviation(resolved(true, 0.1));
  assert.ok(Math.abs(widened.mean - 1) < 0.05, `the reflection's mean kept: ${widened.mean}`);
  assert.ok(
    widened.deviation < MOVING_DEVIATION * widened.mean,
    `deviation ${widened.deviation} under ${MOVING_DEVIATION} of the mean`,
  );
  // The filter held at its still reach, as before #831: the bound is broken.
  const held = deviation(resolved(true, 0.1, { REFLECTION_FILTER_WIDEST: 1 }));
  assert.ok(held.deviation > MOVING_DEVIATION * held.mean, `held: ${held.deviation}`);
});

test('#831: a converged still history is resolved as before, glossy or rough', () => {
  for (const roughness of [0.1, 0.6]) {
    const still = resolved(false, roughness);
    assert.deepEqual(still, resolved(false, roughness, { REFLECTION_FILTER_WIDEST: 1 }));
  }
});
