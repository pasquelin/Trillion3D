import assert from 'node:assert/strict'
import { FLOAT32_MAX, FLOAT32_STEP } from '../constants.ts'
import { halton } from './halton.ts'

/**
 * The input sweep of a rewrite proof: an old expression, the oracle, against its new home, on
 * `HALTON_SWEEP` low-discrepancy points of a span plus its edge values. Halton points cover a span
 * evenly at every prefix, without the clusters and holes of a random draw, and the same on every
 * run: a failure names its index and replays.
 */

/** The points of one sweep: indices 1..HALTON_SWEEP of each base. */
export const HALTON_SWEEP = 4096

/** The `i`-th point (from 1) of the van der Corput sequence in `base`, laid on `[lo, hi)`:
 *  `lo + (hi − lo) · halton(i, base)`. Two bases sweep a plane, three a volume. */
export function haltonSpan(i: number, base: number, lo: number, hi: number) {
  return lo + (hi - lo) * halton(i, base)
}

/** The values a sweep must meet besides its Halton points, those within `[lo, hi]`: the two ends
 *  and the float32 numbers next to them inside, both zeros, ±1, ±one float32 step, the smallest
 *  float32 normal and subnormal, and the largest finite float32 — each once, `Object.is` deciding. */
export function edgeValues(lo: number, hi: number) {
  const inward = (end: number, toward: number) => {
    const rounded = Math.fround(end)
    const step = Math.max(Math.abs(rounded) * FLOAT32_STEP, 2 ** -149)
    return Math.fround(toward > end ? rounded + step : rounded - step)
  }
  const candidates = [
    lo,
    hi,
    inward(lo, hi),
    inward(hi, lo),
    0,
    -0,
    1,
    -1,
    FLOAT32_STEP,
    -FLOAT32_STEP,
    2 ** -126,
    -(2 ** -126),
    2 ** -149,
    -(2 ** -149),
    FLOAT32_MAX,
    -FLOAT32_MAX,
  ]
  const found: number[] = []
  for (const value of candidates)
    if (value >= lo && value <= hi && !found.some((kept) => Object.is(kept, value)))
      found.push(value)
  return found
}

/** Asserts the old expression and the new one round to the same float32, sign of zero and NaN
 *  included: what a GPU buffer holds of either is then the same bits. */
export function assertSameFloat32(old: number, now: number, label: string) {
  assert.ok(
    Object.is(Math.fround(old), Math.fround(now)),
    `${label}: old ${old} and new ${now} round apart in float32`,
  )
}
