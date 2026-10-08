// `halton` before its base-2 word mirror and its integer quotient, word for word but its name:
// the oracle `haltonMoves.test.ts` holds the shipped one to.

export function haltonBefore(index: number, base: number) {
  let result = 0,
    fraction = 1 / base,
    i = index
  while (i > 0) {
    result += fraction * (i % base)
    i = Math.floor(i / base)
    fraction /= base
  }
  return result
}
