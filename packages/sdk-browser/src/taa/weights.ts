/**
 * Weights of the current-frame filter: one per neighbour of the 3×3 window, for a given jitter.
 * Blackman-Harris window over a radius of ONE pixel, centred on the unshifted pixel centre:
 * a neighbour only weighs when this frame's sample is far from the centre, which recentres
 * without softening. They depend only on the jitter, which takes only `TAA_SAMPLES` values: the
 * table is computed once, and never per frame nor per pixel.
 */
import { TAA_SAMPLES, taaJitter } from './jitter.ts';

/** Nine weights, stored neighbour by neighbour (dy then dx, from −1 to 1), three `vec4f` in the uniform. */
export const TAA_WEIGHTS = 12;

/** The window on `[0, 1]` of the radius, zero beyond. */
function blackmanHarris(distance: number) {
  const x = Math.min(1, Math.max(0, distance)) * Math.PI + Math.PI;
  return 0.35875 - 0.48829 * Math.cos(x) + 0.14128 * Math.cos(2 * x) - 0.01168 * Math.cos(3 * x);
}

/**
 * Write the nine normalised weights at `out[at..]`, from jitter `(jx, jy)` in pixels. A
 * point that lands at the centre of a pixel of the shifted image would, without jitter, be `jx`
 * columns to the left and `jy` rows lower — NDC goes up as the screen goes down — so the sample
 * is at `(−jx, +jy)` from the centre, and each neighbour `(dx, dy)` at `(dx − jx, dy + jy)`.
 */
export function taaWeights(jx: number, jy: number, out: Float32Array, at: number) {
  let sum = 0,
    k = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++, k++) {
      const w = blackmanHarris(Math.hypot(dx - jx, dy + jy));
      out[at + k] = w;
      sum += w;
    }
  for (k = 0; k < 9; k++) out[at + k] /= sum;
  for (; k < TAA_WEIGHTS; k++) out[at + k] = 0;
  return out;
}

/** Weights of each of the `TAA_SAMPLES` jitter ranks, ready to copy into the uniform. */
export function taaWeightTable() {
  const jitter = new Float64Array(2);
  return Array.from({ length: TAA_SAMPLES }, (_, sample) => {
    taaJitter(sample, jitter);
    return taaWeights(jitter[0], jitter[1], new Float32Array(TAA_WEIGHTS), 0);
  });
}
