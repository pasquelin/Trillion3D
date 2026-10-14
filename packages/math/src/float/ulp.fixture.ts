// Distances in units in the last place: how many floats lie between two values, the one measure
// the rewrite proofs, the golden twins and the bench's discrepancy counts read.

const view = new DataView(new ArrayBuffer(8))

/**
 * Monotonic rank of a float in bit order: difference of two ranks is ULP discrepancy.
 * 32-bit rank fits in a double int, so no `BigInt` on this path — it is used by
 * images and `Float32Array`, called hundreds of thousands of times during comparison.
 */
function rank32(x: number) {
  view.setFloat32(0, x)
  const b = view.getInt32(0)
  return b < 0 ? -2147483648 - b : b
}

function rank64(x: number) {
  view.setFloat64(0, x)
  const b = view.getBigInt64(0)
  return b < 0n ? -9223372036854775808n - b : b
}

/** ULP discrepancy between two floats, in doubles (`bits` 64) or singles (32): how many floats lie
 *  between them in bit order. `Infinity` as soon as NaN or infinity is not shared. */
export function ulpBetween(a: number, b: number, bits = 64) {
  if (Object.is(a, b)) return 0
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity
  if (bits === 32) return Math.abs(rank32(a) - rank32(b))
  const d = rank64(a) - rank64(b)
  return Number(d < 0n ? -d : d)
}

/** The size of a single's last place at `x`: the step between two singles of its binade, the
 *  smallest normal's at zero. A distance over it is a number of single ULPs at `x`, a fraction of
 *  one included — not the count of singles between two values `ulpBetween` gives. */
export const singleUlp = (x: number) => 2 ** (Math.floor(Math.log2(Math.abs(x) || 2 ** -126)) - 23)
