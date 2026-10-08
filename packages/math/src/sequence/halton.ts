/** 2^32: a 32-bit word read as the fraction of its bits. */
const WORD_RANGE = 4294967296

/**
 * The `index`-th term (from 1) of the van der Corput sequence in base `base`, in [0, 1): the
 * Halton sequence one base at a time. Base 2 is the radical inverse — the bits of `index` mirrored
 * about the point, each digit's weight an exact power of two; bases 2 and 3 are the jitter of
 * temporal antialiasing.
 *
 * Each digit `i % base` weighted by `base^−k`, summed from the lowest. In base 2 every weight is a
 * power of two and the sum of at most 32 of them spans 32 bits, so it is exact: an index of 32 bits
 * mirrors its word, divided by 2^32. An integer base past 1 and an index in [0, 2^31) take the
 * integer quotient `(i / base) | 0` and the remainder `i − q · base`, exact there; any other input
 * takes `%` and `Math.floor`.
 */
export function halton(index: number, base: number) {
  if (base === 2 && index === index >>> 0) {
    let i = index
    i = ((i >>> 1) & 0x55555555) | ((i & 0x55555555) << 1)
    i = ((i >>> 2) & 0x33333333) | ((i & 0x33333333) << 2)
    i = ((i >>> 4) & 0x0f0f0f0f) | ((i & 0x0f0f0f0f) << 4)
    i = ((i >>> 8) & 0x00ff00ff) | ((i & 0x00ff00ff) << 8)
    return (((i >>> 16) | (i << 16)) >>> 0) / WORD_RANGE
  }
  let result = 0,
    fraction = 1 / base,
    i = index
  if (index === (index | 0) && index >= 0 && base === (base | 0) && base > 1) {
    while (i > 0) {
      const q = (i / base) | 0
      result += fraction * (i - q * base)
      i = q
      fraction /= base
    }
    return result
  }
  while (i > 0) {
    result += fraction * (i % base)
    i = Math.floor(i / base)
    fraction /= base
  }
  return result
}
