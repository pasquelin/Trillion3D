/**
 * The examples' seeded numbers, one module for the kit and the pages: the same seed gives the
 * same scene on every run and every machine. Each generator keeps the exact sequence its scenes
 * were laid out with, so gathering them here moved nothing on screen. Plenty for placing pebbles
 * and stones, never for anything that must be unpredictable.
 */

/** A sequence of numbers in [0, 1) from a seed. */
export type Random = () => number;

/** The example pages' sequence: a linear congruential step on 32-bit integers, the constants of
 *  Numerical Recipes. */
export function seeded(seed: number): Random {
  let state = seed >>> 0;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
}

/** The temple's scatter: a value in [0, 1) for `index` and channel `k`, the fraction of a scaled
 *  sine. */
export function sineHash(index: number, k: number): number {
  const t = Math.sin(index * 12.9898 + k * 78.233) * 43758.5453;
  return t - Math.floor(t);
}
