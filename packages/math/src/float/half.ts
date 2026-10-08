/** One float64 and its two 32-bit words, the buffer `fromHalf` builds a normal half through. */
const f64 = new Float64Array(1),
  f64Words = new Uint32Array(f64.buffer)

/**
 * The value of a half float's sixteen bits (IEEE 754 binary16): a normal half
 * `(1 + fraction / 1024) * 2 ** (exponent - 15)`, a subnormal one `fraction * 2 ** -24`, negated
 * when the sign bit is set (-0 kept). Exponent 31 reads by the normal rule, `2 ** 16` and up: a
 * caller that meets infinity or NaN decodes it itself.
 *
 * A normal half is exact in a double, so its double is written as bits: the sign, the exponent
 * rebiased by 1023 − 15, the ten fraction bits on top of the double's fifty-two. Word 1 of the
 * buffer is the double's high word on a little-endian host — every typed array the engine runs on,
 * as `toHalf` reads float32 bits through one. A subnormal half takes the product, `-0` its sign.
 */
export function fromHalf(bits: number) {
  const exponent = (bits >> 10) & 31,
    fraction = bits & 1023
  if (exponent === 0) {
    const magnitude = fraction * 2 ** -24
    return bits & 0x8000 ? -magnitude : magnitude
  }
  f64Words[0] = 0
  f64Words[1] = ((bits & 0x8000) << 16) | ((exponent + 1008) << 20) | (fraction << 10)
  return f64[0]
}

/** One float32 and its bits, the buffer `toHalf` rounds through. */
const f32 = new Float32Array(1),
  u32 = new Uint32Array(f32.buffer)

/**
 * The nearest half float of `value`, its sixteen bits (IEEE 754 binary16, ties to even; NaN stays
 * a quiet NaN of the same sign): no allocation, a per-frame reader calls it. The float32 bits are
 * rounded once more; a float64 that float32 rounding put exactly on a tie is decided by the side
 * of the tie it lies on, so no double rounding.
 */
export function toHalf(value: number) {
  f32[0] = value
  const bits = u32[0],
    sign = (bits >>> 16) & 0x8000,
    magnitude = bits & 0x7fffffff
  if (magnitude >= 0x47800000) return sign | (magnitude > 0x7f800000 ? 0x7e00 : 0x7c00)
  const exponent = magnitude >>> 23,
    normal = exponent > 112,
    shift = normal ? 13 : 126 - exponent
  if (shift > 24) return sign
  // A normal half rebiased in place; a subnormal one counts steps of 2^-24.
  const kept = normal ? magnitude - 0x38000000 : (magnitude & 0x7fffff) | 0x800000,
    half = 1 << (shift - 1),
    rest = kept & (2 * half - 1)
  const up =
    rest > half ||
    (rest === half &&
      (f32[0] === value ? (kept >>> shift) & 1 : Math.abs(value) > Math.abs(f32[0])))
  return sign | ((kept >>> shift) + (up ? 1 : 0))
}
