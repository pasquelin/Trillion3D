/**
 * The repository's seeded numbers, one module for the kit, the pages, the scenes modelled in code,
 * the bench and the correctness campaigns: the same seed gives the same scene on every run and
 * every machine. Each generator keeps the exact sequence its scenes were laid out with, so
 * gathering them here moved nothing on screen. Plenty for placing pebbles and stones, never for
 * anything that must be unpredictable.
 */

import { ease } from './opening.ts'
import {
  lcgRandom,
  mulberry32 as mulberry32Sequence,
} from '../../../packages/math/src/sequence/random.ts'
import { fract } from '../../../packages/math/src/scalar/reals.ts'
import type { Families } from './engineTypes.ts'

/** A sequence of numbers in [0, 1) from a seed. */
export type Random = () => number

/** The example pages' sequence: `lcgRandom`, a linear congruential step on 32-bit integers, so a
 *  seed always gives the same numbers. */
export const seeded: (seed: number) => Random = lcgRandom

/** Mulberry32: a 32-bit sequence on integer arithmetic alone, so every machine draws the same
 *  numbers; the scenes modelled in code, the bench's facade and the correctness campaigns. */
export const mulberry32: (seed: number) => Random = mulberry32Sequence

/** The temple's scatter: a value in [0, 1) for `index` and channel `k`, the fraction of a scaled
 *  sine. */
export function sineHash(index: number, k: number): number {
  return fract(Math.sin(index * 12.9898 + k * 78.233) * 43758.5453)
}

/**
 * Smooth value noise in [-1, 1] in up to three dimensions: hashed values at the whole lattice
 * points, joined by a smoothstep along each axis. A whole `z` reads a flat slice, so a 2D relief
 * passes its octave there; `seed` draws another field. The lattice is hashed with the odd
 * multipliers of the `z` axis and of the seed given here, so each page keeps the relief it was
 * laid out with. The blends are the engine's `math.lerp`, handed in with the families.
 */
export function valueNoise(
  { math }: Families<'math'>,
  zMultiplier = 2147483647,
  seedMultiplier = 1597334677,
) {
  const { lerp } = math
  const lattice = (i: number, j: number, k: number, seed: number) => {
    let h =
      Math.imul(i, 374761393) ^
      Math.imul(j, 668265263) ^
      Math.imul(k, zMultiplier) ^
      Math.imul(seed, seedMultiplier)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
  return (x: number, y: number, z = 0, seed = 0): number => {
    const i = Math.floor(x),
      j = Math.floor(y),
      k = Math.floor(z)
    const u = ease.smooth(x - i),
      v = ease.smooth(y - j),
      w = ease.smooth(z - k)
    const plane = (dk: number) =>
      lerp(
        lerp(lattice(i, j, k + dk, seed), lattice(i + 1, j, k + dk, seed), u),
        lerp(lattice(i, j + 1, k + dk, seed), lattice(i + 1, j + 1, k + dk, seed), u),
        v,
      )
    return lerp(plane(0), plane(1), w) * 2 - 1
  }
}
