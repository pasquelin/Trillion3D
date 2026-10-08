// Bit sets on the host, for the tests and mocks that fill or read the shaders' bit words: the
// shaders' `bitWord`, `bitMask` and `bitAt` (`../wgsl/integer.ts`) are the engine's.

/** Sets bit `i` (a non-negative int32) of the bit set `words`: `words[i >>> 5] |= 1 << (i & 31)`,
 *  the host twin of the shaders' `bitWord` and `bitMask` (`../wgsl/integer.ts`). */
export const setBit = (words: Uint32Array, i: number) => {
  words[i >>> 5] |= 1 << (i & 31)
}

/** Bit `i` (a non-negative int32) of the bit set `words`, 0 or 1: `(words[i >>> 5] >>> (i & 31)) & 1`,
 *  the host twin of the shaders' `bitAt`. */
export const testBit = (words: ArrayLike<number>, i: number) => (words[i >>> 5] >>> (i & 31)) & 1
