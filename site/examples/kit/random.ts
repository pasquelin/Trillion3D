/**
 * The examples' seeded numbers, one module for the kit, the open world and the pages: the same
 * seed gives the same scene on every run and every machine. Each generator keeps the exact
 * sequence its scenes were laid out with, so gathering them here moved nothing on screen. Plenty
 * for placing pebbles, clouds and traffic, never for anything that must be unpredictable.
 */

import { ease } from './opening.ts';

/** A sequence of numbers in [0, 1) from a seed. */
export type Random = () => number;

/** The example pages' sequence: a linear congruential step on 32-bit integers, the constants of
 *  Numerical Recipes. */
export function seeded(seed: number): Random {
  let state = seed >>> 0;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
}

/** The open world's sequence (sky and simulation): mulberry32, a counter-based generator with
 *  32 bits of state and one multiply chain per draw. */
export function mulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A value in [0, 1) for integer `index` under `seed`, without walking a sequence. */
export function hash(seed: number, index: number): number {
  let t = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(index | 0, 0x85ebca77)) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x7feb352d);
  t = Math.imul(t ^ (t >>> 15), 0x846ca68b);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

/** The temple's scatter: a value in [0, 1) for `index` and channel `k`, the fraction of a scaled
 *  sine. */
export function sineHash(index: number, k: number): number {
  const t = Math.sin(index * 12.9898 + k * 78.233) * 43758.5453;
  return t - Math.floor(t);
}

/**
 * Smooth noise in [-1, 1] along one axis: hashed values at whole numbers, joined by a
 * smoothstep, so the curve and its slope are continuous (gusts rise and fall, never jump).
 */
export function noise1(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  return (hash(seed, i) * (1 - s) + hash(seed, i + 1) * s) * 2 - 1;
}

/** A value in [0, 1) at a whole lattice point under `seed`: a corner `valueNoise` joins. */
function lattice(i: number, j: number, k: number, seed: number) {
  let h =
    Math.imul(i, 374761393) ^
    Math.imul(j, 668265263) ^
    Math.imul(k, 2147483647) ^
    Math.imul(seed, 1597334677);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Smooth value noise in [-1, 1] in up to three dimensions: hashed values at the whole lattice
 * points, joined by a smoothstep along each axis. A whole `z` reads a flat slice, so a 2D relief
 * passes its octave there; `seed` draws another field.
 */
export function valueNoise(x: number, y: number, z = 0, seed = 0): number {
  const i = Math.floor(x),
    j = Math.floor(y),
    k = Math.floor(z);
  const u = ease.smooth(x - i),
    v = ease.smooth(y - j),
    w = ease.smooth(z - k);
  const plane = (dk: number) =>
    lerp(
      lerp(lattice(i, j, k + dk, seed), lattice(i + 1, j, k + dk, seed), u),
      lerp(lattice(i, j + 1, k + dk, seed), lattice(i + 1, j + 1, k + dk, seed), u),
      v,
    );
  return lerp(plane(0), plane(1), w) * 2 - 1;
}
