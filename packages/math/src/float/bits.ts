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
