// `fromHalf` before it wrote a normal half's double as bits, word for word but its name: the
// oracle `halfMoves.test.ts` holds the shipped one to.

export function fromHalfBefore(bits: number) {
  const exponent = (bits >> 10) & 31,
    fraction = bits & 1023
  const magnitude = exponent ? (1 + fraction / 1024) * 2 ** (exponent - 15) : fraction * 2 ** -24
  return bits & 0x8000 ? -magnitude : magnitude
}
