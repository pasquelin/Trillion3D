/**
 * THE CPU TWIN OF THE 11-11-10 WORD (`unpackLight` of `smallFloatWgsl.ts`): the colour a word holds, read back by the CPU — six bits of mantissa
 * after five of exponent for red and green, five for blue, the first in the low bits, a field of exponent 0 a denormal.
 */
const field = (bits: number, mantissa: number) => {
  const exponent = bits >>> mantissa
  const fraction = bits & ((1 << mantissa) - 1)
  return exponent === 0
    ? fraction / 2 ** (14 + mantissa)
    : 2 ** (exponent - 15) * (1 + fraction / 2 ** mantissa)
}

/** The colour of the word `word`. */
export const unpackLightWord = (word: number): [number, number, number] => [
  field(word & 0x7ff, 6),
  field((word >>> 11) & 0x7ff, 6),
  field(word >>> 22, 5),
]
