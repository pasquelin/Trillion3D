import assert from 'node:assert/strict'
import type { NumberSink } from '../matrix/matrix4.ts'
import { perspectiveProjection } from '../projection/camera.ts'
import { edgeValues, haltonSpan } from './sweep.fixture.ts'

/**
 * The inputs of a rewrite proof past the float32 ones: the sweep's `edgeValues` over the whole line
 * (±∞ included) and NaN, the float64 subnormals and extremes, and values a rounding meets at its
 * edges. A rewrite of a float64 body meets them all, `Object.is` deciding.
 */
export const HOSTILE_VALUES = [
  ...edgeValues(-Infinity, Infinity),
  NaN,
  2 ** -1074,
  -(2 ** -1074),
  2 ** -1022,
  -(2 ** -1022),
  Number.MAX_VALUE,
  -Number.MAX_VALUE,
  0.5,
  -0.5,
  1e300,
  -1e-300,
]

/** Input `slot` of sweep case `i` (from 1): the Halton point `i · 61 + slot` of `base` on
 *  `[lo, hi)`, or, one slot in seven, the next of `HOSTILE_VALUES`, so every case mixes the span
 *  and its edges. */
export function sweepInput(i: number, slot: number, base: number, lo: number, hi: number) {
  return (i + slot) % 7 === 0
    ? HOSTILE_VALUES[(i * 3 + slot) % HOSTILE_VALUES.length]
    : haltonSpan(i * 61 + slot + 1, base, lo, hi)
}

/** The matrix kinds a proof sweeps: general, affine (last row `0, 0, 0, 1`, zeros of either
 *  sign), a reversed-depth perspective, a perspective with a translation, and the affine one with
 *  its last row moved: a `w` other than 1, or one tiny term beside the zeros. */
export const MATRIX_KINDS = 5

/** The last entries a moved affine row takes. */
const MOVED_W = [0, -0, 2, 0.5, -1, 1 + 2 ** -52, NaN, Infinity]

/** Sweep case `i`'s matrix of `kind` into `out`, its entries from `sweepInput` on `[−4, 4)`. */
export function sweepMatrix(out: Float64Array, i: number, kind: number) {
  for (let k = 0; k < 16; k++) out[k] = sweepInput(i, k, 3, -4, 4)
  if (kind === 1 || kind === 4) {
    out[3] = i & 1 ? -0 : 0
    out[7] = i & 2 ? -0 : 0
    out[11] = 0
    out[15] = 1
    if (kind === 4 && i & 4) out[3 + 4 * (i % 3)] = 2 ** -1074
    else if (kind === 4) out[15] = MOVED_W[(i >> 3) % MOVED_W.length]
  } else if (kind > 1) {
    const fov = haltonSpan(i, 5, 1, 179),
      near = haltonSpan(i, 7, 1e-3, 10)
    perspectiveProjection(out, fov, haltonSpan(i, 2, 0.25, 4), near, 1)
    if (kind === 3) {
      out[12] = sweepInput(i, 12, 2, -100, 100)
      out[13] = sweepInput(i, 13, 2, -100, 100)
    }
  }
  return out
}

/** Asserts `old` and `now` hold the same numbers, `Object.is` deciding: sign of zero and NaN. */
export function assertSameBits(old: ArrayLike<number>, now: ArrayLike<number>, label: string) {
  assert.equal(now.length, old.length, `${label}: length`)
  for (let k = 0; k < old.length; k++)
    if (!Object.is(old[k], now[k])) assert.fail(`${label}[${k}]: old ${old[k]}, new ${now[k]}`)
}

/** The sinks a `NumberSink` takes, each filled from `values`: doubles, floats, plain, integers. */
export const SINKS: ((values: ArrayLike<number>) => NumberSink & ArrayLike<number>)[] = [
  (values) => Float64Array.from(values),
  (values) => Float32Array.from(values),
  (values) => Array.from(values),
  (values) => Int32Array.from(values),
]

/** `values` as sink kind `kind`, an index into `SINKS`: 0 `Float64Array`, 1 `Float32Array`, 2 a
 *  plain array, 3 an `Int32Array`. */
export const typed = (kind: number, values: ArrayLike<number>) => SINKS[kind](values)

/** Eighteen sentinels: the two past a matrix's sixteen catch a stray write. */
export const SENTINELS = new Float64Array(18).fill(7)
