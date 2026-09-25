// #55: why the cutout needs no stipple under temporal antialiasing. On a still camera the jitter
// moves each pixel's sample across its footprint, so the HARD cut, accumulated, already converges
// to the pixel's coverage of the alpha as read. This file replays that on the CPU with the temporal
// pass's own jitter, filter weights, neighbour clamp and 1/k share (`../../taa/shaderWgsl.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TAA_SAMPLES, TAA_STILL_FRAMES, taaJitter } from '../../taa/jitter.ts';
import { taaWeightTable } from '../../taa/weights.ts';

const SIDE = 24,
  THRESHOLD = 0.5,
  SUB = 16;
const weights = taaWeightTable();
type Field = (x: number, y: number) => number;

/** One image of the temporal resolve on a still camera: history re-read on its own texel, clamped
 *  to the 3×3 box of the current image, mixed at 1/k. The leaf and what lies behind it share one
 *  luminance, so the resolve's inverse-luminance weights are the plain 1/k. */
function resolve(current: Float64Array, history: Float64Array, frame: number, w: Float32Array) {
  const out = new Float64Array(SIDE * SIDE),
    at = (v: number) => Math.min(SIDE - 1, Math.max(0, v));
  for (let y = 0; y < SIDE; y++)
    for (let x = 0; x < SIDE; x++) {
      let filtered = 0,
        lo = Infinity,
        hi = -Infinity,
        k = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++, k++) {
          const v = current[at(y + dy) * SIDE + at(x + dx)]!;
          filtered += v * w[k]!;
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      const kept = Math.min(hi, Math.max(lo, history[y * SIDE + x]!));
      out[y * SIDE + x] = frame === 1 ? filtered : filtered / frame + kept * (1 - 1 / frame);
    }
  return out;
}

/** The held image of `TAA_STILL_FRAMES` still images, each pixel drawn by `pixel` at its
 *  jittered sample — the sample is at `(−jx, +jy)` from the centre (`../../taa/weights.ts`). */
function held(pixel: (px: number, py: number) => number) {
  const jitter = new Float64Array(2);
  let image = new Float64Array(SIDE * SIDE);
  for (let frame = 1; frame <= TAA_STILL_FRAMES; frame++) {
    const sample = (frame - 1) % TAA_SAMPLES;
    taaJitter(sample, jitter);
    const current = new Float64Array(SIDE * SIDE);
    for (let y = 0; y < SIDE; y++)
      for (let x = 0; x < SIDE; x++)
        current[y * SIDE + x] = pixel(x + 0.5 - jitter[0]!, y + 0.5 + jitter[1]!);
    image = resolve(current, image, frame, weights[sample]!);
  }
  return image;
}

/** The hard cut at the sample, and the exact coverage of the pixel around it (16×16 points). */
const hard = (alpha: Field) => (px: number, py: number) => +(alpha(px, py) >= THRESHOLD);
const coverage = (alpha: Field) => (px: number, py: number) => {
  let inside = 0;
  for (let i = 0; i < SUB; i++)
    for (let j = 0; j < SUB; j++)
      inside += hard(alpha)(px - 0.5 + (i + 0.5) / SUB, py - 0.5 + (j + 0.5) / SUB);
  return inside / (SUB * SUB);
};

/** A leaf edge across the frame, slanted. */
const edge: Field = (x, y) => Math.min(1, Math.max(0, 0.5 + 0.8 * (x - 12) + 0.6 * (y - 12)));
/** A small round leaf, `radius` pixels. */
const leaf =
  (radius: number): Field =>
  (x, y) =>
    Math.max(0, 1 - Math.hypot(x - 11.7, y - 12.2) / (2 * radius));
/** A thin branch, a ridge of peak alpha `peak` and half-width `sigma` pixels. */
const branch =
  (peak: number, sigma: number): Field =>
  (x, y) => {
    const d = 0.8 * (x - 12) + 0.6 * (y - 12);
    return peak * Math.exp(-(d * d) / (2 * sigma * sigma));
  };

test('the hard cut, accumulated on a still camera, converges to the coverage of the alpha read', () => {
  for (const [name, alpha] of [
    ['straight edge', edge],
    ['round leaf', leaf(3.3)],
    ['thin branch', branch(0.9, 0.3)],
  ] as [string, Field][]) {
    const [got, want] = [held(hard(alpha)), held(coverage(alpha))];
    // Only the pixels the silhouette crosses: the others are all or nothing on both sides.
    const crossed = [...want.keys()].filter((i) => want[i]! > 1e-3 && want[i]! < 1 - 1e-3);
    const errors = crossed.map((i) => Math.abs(got[i]! - want[i]!));
    const worst = Math.max(...errors),
      mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    // Eight jitter positions: a pixel lands within a fifth of its coverage, on average a twentieth.
    assert.ok(worst < 0.2, `${name}: worst pixel ${worst.toFixed(3)}`);
    assert.ok(mean < 0.05, `${name}: mean ${mean.toFixed(4)}`);
  }
});
