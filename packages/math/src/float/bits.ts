/** One float32 and its bits, the word every reading below goes through: no allocation, a per-frame
 *  caller may use them. */
const word = new Float32Array(1),
  wordBits = new Uint32Array(word.buffer)

/** The bits of `value` as a float32 stores it (rounded to nearest, ties to even, as `Math.fround`),
 *  an unsigned 32-bit word: what a shader reads by `bitcast<u32>` of the same float. */
export const f32Bits = (value: number) => ((word[0] = value), wordBits[0])

/** The float32 whose bits are `bits` (its low 32 bits, as a `Uint32Array` stores them): what a
 *  shader reads by `bitcast<f32>` of the same word. */
export const fromF32Bits = (bits: number) => ((wordBits[0] = bits), word[0])

/** `value` rounded up to a float32: the least float32 at or above it — `Math.fround(value)` when
 *  that does not round it down, else the float32 next above, read off its bits (across zero, the
 *  least subnormal; below every finite float32, the least of them). NaN stays NaN. */
export function f32Up(value: number) {
  const f = Math.fround(value)
  if (!(f < value)) return f
  if (f === 0) return fromF32Bits(1)
  const bits = f32Bits(f)
  return fromF32Bits(f > 0 ? bits + 1 : bits - 1)
}

/** One float64 and its two 32-bit words: word 1 is the high word on a little-endian host, every
 *  typed array the engine runs on. No allocation, as the float32 word above. */
const double = new Float64Array(1),
  doubleWords = new Uint32Array(double.buffer)

/** The high word of the double `value`: sign, eleven exponent bits, twenty mantissa bits. */
export const f64High = (value: number) => ((double[0] = value), doubleWords[1])

/** The low word of the double `value`: its last thirty-two mantissa bits. */
export const f64Low = (value: number) => ((double[0] = value), doubleWords[0])

/** Writes the double `value` as its two words, the high word at `out[at]` and the low word at
 *  `out[at + 1]`: one store, both words read off it. */
export function f64WordsInto(out: Uint32Array, at: number, value: number) {
  double[0] = value
  out[at] = doubleWords[1]
  out[at + 1] = doubleWords[0]
}

/** The double whose high word is `high` and low word `low`. */
export const fromF64Words = (high: number, low: number) => (
  (doubleWords[1] = high),
  (doubleWords[0] = low),
  double[0]
)
