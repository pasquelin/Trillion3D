/**
 * What every reader of a `WGP3` page's bit-packed fields shares, the rules of the shared codec
 * (`packages/page-codec-wasm/src/bits.rs`) in JavaScript: a field read at random, the bits a range
 * takes, a grid value back to its float and a normal's octahedral bytes back to a unit vector. They
 * sit here rather than in one reader because the header's block table and link bounds, the
 * deformation streams and the page decoder all read fields and none of them parses the others.
 */
import { floorLog2 } from '../../../../math/src/scalar/integers.ts'
import { length3Float32 } from '../../../../math/src/vector/lengthFloat32.ts'
import { OCT_BYTE_STEP } from '../../../../math/src/constants.ts'

/** The `bits`-bit field at bit `at` of `words`; a field spans two words at most
 *  (`BitReader::at(words, at).read(bits)`). */
export function field(words: Uint32Array, at: number, bits: number) {
  if (!bits) return 0
  const shift = at % 32,
    index = at >>> 5
  let value = words[index] >>> shift
  if (shift + bits > 32) value |= words[index + 1] << (32 - shift)
  return value & ((1 << bits) - 1)
}

/** Bits that hold every value of `0..=range`, a range below 2^32; none for a constant field. */
export const bitsFor = (range: number) => (range <= 0 ? 0 : floorLog2(range) + 1)

const f = Math.fround

/** A grid value back to its float, `min + q * step` in 32-bit steps, the product exact and the sum
 *  rounded once: the one every reader decodes with (`dequant`, `bits/quant.rs`). */
export const dequant = (min: number, q: number, step: number) => f(min + f(q * step))

/** A normal's octahedral bytes (`x` low, `y` high) back to a unit vector at `out[at..at + 3]`, in
 *  32-bit steps. */
export function octDecode(q: number, out: { [i: number]: number }, at = 0) {
  let x = f(f((q & 255) * OCT_BYTE_STEP) - 1),
    y = f(f(((q >>> 8) & 255) * OCT_BYTE_STEP) - 1)
  const z = f(f(1 - Math.abs(x)) - Math.abs(y))
  if (z < 0) {
    const fx = f(f(1 - Math.abs(y)) * (x >= 0 ? 1 : -1))
    y = f(f(1 - Math.abs(x)) * (y >= 0 ? 1 : -1))
    x = fx
  }
  const length = length3Float32(x, y, z)
  out[at] = f(x / length)
  out[at + 1] = f(y / length)
  out[at + 2] = f(z / length)
}
