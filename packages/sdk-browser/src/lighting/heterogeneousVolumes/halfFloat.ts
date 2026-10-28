/** A 32-bit float as a half's bits, rounded to nearest even; out of range is infinity. */
export function floatToHalf(value: number): number {
  const f = new Float32Array([value])
  const x = new Uint32Array(f.buffer)[0]
  const sign = (x >>> 16) & 0x8000
  const exponent = (x >>> 23) & 0xff
  let mantissa = x & 0x7fffff
  if (exponent === 0xff) return sign | 0x7c00 | (mantissa ? 0x200 : 0)
  const e = exponent - 127 + 15
  if (e >= 31) return sign | 0x7c00
  if (e <= 0) {
    if (e < -10) return sign
    mantissa |= 0x800000
    const shift = 14 - e
    const half = mantissa >> shift
    const rest = mantissa & ((1 << shift) - 1)
    const mid = 1 << (shift - 1)
    return sign | (half + (rest > mid || (rest === mid && half & 1) ? 1 : 0))
  }
  const half = sign | (e << 10) | (mantissa >> 13)
  const rest = mantissa & 0x1fff
  return half + (rest > 0x1000 || (rest === 0x1000 && half & 1) ? 1 : 0)
}
