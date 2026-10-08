// `nextPow2` before its shift, word for word but its name: the oracle `integersMoves.test.ts`
// holds the shipped one to.

const ceilLog2 = (v: number) => 32 - Math.clz32(v - 1)

export function nextPow2Before(v: number) {
  if (v <= 1) return 1
  if (v <= 2 ** 32) return 2 ** ceilLog2(Math.ceil(v))
  if (v !== v) return NaN
  throw new RangeError(`nextPow2: ${v} is past 2^32`)
}
