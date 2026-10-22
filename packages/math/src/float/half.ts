import { HALF_MAX } from '../constants.ts'
import { f32Bits, fromF64Words } from './bits.ts'

/**
 * The value of a half float's sixteen bits (IEEE 754 binary16): a normal half
 * `(1 + fraction / 1024) * 2 ** (exponent - 15)`, a subnormal one `fraction * 2 ** -24`, negated
 * when the sign bit is set (-0 kept). Exponent 31 reads by the normal rule, `2 ** 16` and up: a
 * caller that meets infinity or NaN decodes it itself.
 *
 * A normal half is exact in a double, so its double is written as bits: the sign, the exponent
 * rebiased by 1023 − 15, the ten fraction bits on top of the double's fifty-two (`fromF64Words`).
 * A subnormal half takes the product, `-0` its sign.
 */
export function fromHalf(bits: number) {
  const exponent = (bits >> 10) & 31,
    fraction = bits & 1023
  if (exponent === 0) {
    const magnitude = fraction * 2 ** -24
    return bits & 0x8000 ? -magnitude : magnitude
  }
  return fromF64Words(((bits & 0x8000) << 16) | ((exponent + 1008) << 20) | (fraction << 10), 0)
}

/** The bits of the half float +∞: exponent all ones, no mantissa. A larger magnitude's sign is
 *  ORed onto it. */
const HALF_INFINITY = 0x7c00

/**
 * The nearest half float of `value`, its sixteen bits (IEEE 754 binary16, ties to even; NaN stays
 * a quiet NaN of the same sign): no allocation, a per-frame reader calls it. The float32 bits are
 * rounded once more; a float64 that float32 rounding put exactly on a tie is decided by the side
 * of the tie it lies on, so no double rounding.
 */
export function toHalf(value: number) {
  const bits = f32Bits(value),
    sign = (bits >>> 16) & 0x8000,
    magnitude = bits & 0x7fffffff
  if (magnitude >= 0x47800000) return sign | (magnitude > 0x7f800000 ? 0x7e00 : HALF_INFINITY)
  const exponent = magnitude >>> 23,
    normal = exponent > 112,
    shift = normal ? 13 : 126 - exponent
  if (shift > 24) return sign
  // A normal half rebiased in place; a subnormal one counts steps of 2^-24.
  const kept = normal ? magnitude - 0x38000000 : (magnitude & 0x7fffff) | 0x800000,
    half = 1 << (shift - 1),
    rest = kept & (2 * half - 1)
  const rounded = Math.fround(value)
  const up =
    rest > half ||
    (rest === half &&
      (rounded === value ? (kept >>> shift) & 1 : Math.abs(value) > Math.abs(rounded)))
  return sign | ((kept >>> shift) + (up ? 1 : 0))
}

/** The value of half `bits` as a store of it reads back: exponent 31 the infinities (and NaN). */
function halfRead(bits: number) {
  if ((bits & HALF_INFINITY) !== HALF_INFINITY) return fromHalf(bits)
  if (bits & 1023) return NaN
  return bits & 0x8000 ? -Infinity : Infinity
}

/**
 * `value` as the nearest half, ties to even, rounded once from the double (`Math.f16round`'s
 * result, which Node 22 lacks) — past the largest finite half, infinity.
 */
export const halfRound = (value: number) => halfRead(toHalf(value))

/**
 * `value` as a half store keeps it: made a float32 first, the precision errors are built in, then
 * the nearest half, ties to even — past the largest finite half, infinity.
 */
export const halfNearest = (value: number) => halfRead(toHalf(Math.fround(value)))

/**
 * `value` made a float32, then the greatest half at or below it: a least bound rounded never above
 * what it bounds. The nearest half steps down until it holds — from zero to `-0`, a negative one
 * outwards —, no further than the last half pattern.
 */
export function halfFloor(value: number) {
  const single = Math.fround(value)
  let bits = toHalf(single)
  while (halfRead(bits) > single && bits !== 0xffff)
    bits = bits === 0 ? 0x8000 : bits & 0x8000 ? bits + 1 : bits - 1
  return halfRead(bits)
}

/**
 * The bits of the smallest half float at or above `value`, a reach a reader never finds below what
 * it bounds: 0 for a value that is no positive number, the infinity's bits (`0x7c00`) past the
 * largest finite half. The nearest half steps up until it holds.
 */
export function halfCeilBits(value: number) {
  if (!(value > 0)) return 0
  if (value > HALF_MAX) return HALF_INFINITY
  let bits = toHalf(value)
  while (halfRead(bits) < value) bits++
  return bits
}
