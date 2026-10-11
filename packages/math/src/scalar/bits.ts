// Bit sets on the host, the words the shaders' `bitWord`, `bitMask` and `bitAt`
// (`../wgsl/integer.ts`) fill and read.

/** Whether bit `i` (a non-negative int32) of the bit set `words` is set: `words[i >>> 5]` read at
 *  `i & 31`, the host twin of the shaders' `bitAt`. */
export const hasBit = (words: ArrayLike<number>, i: number) =>
  (words[i >>> 5] & (1 << (i & 31))) !== 0

/** Sets bit `i` (a non-negative int32) of the bit set `words`: `words[i >>> 5] |= 1 << (i & 31)`,
 *  the host twin of the shaders' `bitWord` and `bitMask` (`../wgsl/integer.ts`). */
export const setBit = (words: Uint32Array, i: number) => {
  words[i >>> 5] |= 1 << (i & 31)
}
