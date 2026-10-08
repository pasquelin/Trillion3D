// Bit reads on the host, for the tests and mocks that read the shaders' bit words: the shaders'
// `bitAt` (`../wgsl/integer.ts`) is the engine's; `setBit` (`./bits.ts`) writes them.

/** Bit `i` (a non-negative int32) of the bit set `words`, 0 or 1: `(words[i >>> 5] >>> (i & 31)) & 1`,
 *  the host twin of the shaders' `bitAt`. */
export const testBit = (words: ArrayLike<number>, i: number) => (words[i >>> 5] >>> (i & 31)) & 1
