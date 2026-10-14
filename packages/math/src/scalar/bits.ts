// Bit sets on the host, the words the shaders' `bitWord`, `bitMask` and `bitAt`
// (`../wgsl/integer.ts`) fill and read. A set may start at word `base` of a larger table.

/** Whether bit `i` (a non-negative int32) of the bit set at word `base` of `words` is set:
 *  `words[base + (i >>> 5)]` read at `i & 31`, the host twin of the shaders' `bitAt`. */
export const hasBit = (words: ArrayLike<number>, i: number, base = 0) =>
  (words[base + (i >>> 5)] & (1 << (i & 31))) !== 0

/** Sets bit `i` (a non-negative int32) of the bit set at word `base` of `words`:
 *  `words[base + (i >>> 5)] |= 1 << (i & 31)`, the host twin of the shaders' `bitWord` and
 *  `bitMask` (`../wgsl/integer.ts`). */
export const setBit = (words: Uint32Array, i: number, base = 0) => {
  words[base + (i >>> 5)] |= 1 << (i & 31)
}

/** Flips bit `i` (a non-negative int32) of the bit set at word `base` of `words`. */
export const flipBit = (words: Uint32Array, i: number, base = 0) => {
  words[base + (i >>> 5)] ^= 1 << (i & 31)
}

/** The index of the lowest set bit of the non-zero word `bits`: a walk of a word's set bits reads
 *  it, then clears it (`bits &= bits - 1`), one step a set bit. */
export const lowestBit = (bits: number) => 31 - Math.clz32(bits & -bits)
