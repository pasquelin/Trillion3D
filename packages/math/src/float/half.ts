/**
 * The value of a half float's sixteen bits (IEEE 754 binary16): a normal half
 * `(1 + fraction / 1024) * 2 ** (exponent - 15)`, a subnormal one `fraction * 2 ** -24`, negated
 * when the sign bit is set (-0 kept). Exponent 31 reads by the normal rule, `2 ** 16` and up: a
 * caller that meets infinity or NaN decodes it itself.
 */
export function fromHalf(bits: number) {
  const exponent = (bits >> 10) & 31,
    fraction = bits & 1023
  const magnitude = exponent ? (1 + fraction / 1024) * 2 ** (exponent - 15) : fraction * 2 ** -24
  return bits & 0x8000 ? -magnitude : magnitude
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
