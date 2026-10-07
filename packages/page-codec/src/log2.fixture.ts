/**
 * The exact integers of the correctly rounded `log2 x`, from the bits of `x` and rational bounds of
 * ln 2, the same in every engine: the reference the grids' logarithms are tested against, a port
 * term for term of the Rust one (`page-codec-wasm/src/bits/log2_tests.rs`, `exact`), whose own test
 * proves the bound of ln 2. Test-only.
 */

/** ⌊ln 2 · 2^64⌋: ln 2 · 2^64 lies strictly between it and the next integer. */
const LN2_64 = 0xb172_17f7_d1cf_79abn

const view = new DataView(new ArrayBuffer(8))
const bitsOf = (x: number) => (view.setFloat64(0, x), view.getBigUint64(0))
const fromBits = (bits: bigint) => (view.setBigUint64(0, bits), view.getFloat64(0))
const bitLength = (m: bigint) => m.toString(2).length - Number(m === 0n)

/** `x = m · 2^p` exactly for a positive finite `x`: its integer significand and its exponent. */
function parts(x: number): [m: bigint, p: number] {
  const bits = bitsOf(x),
    field = Number(bits >> 52n),
    fraction = bits & ((1n << 52n) - 1n)
  return field === 0 ? [fraction, -1074] : [fraction | (1n << 52n), field - 1075]
}

/** The exponent of half the gap between the integer `n` and the double next to it, above or
 *  below. */
function halfGap(n: number, above: boolean) {
  const outward = n > 0 === above
  const next = n === 0 ? (above ? 5e-324 : -5e-324) : fromBits(bitsOf(n) + (outward ? 1n : -1n))
  const [m, p] = parts(Math.abs(next - n))
  return p + bitLength(m) - 2
}

/** Whether `d · 2^shift`, a distance to a power of two over half a gap in units of 2^-64, lies
 *  under `low`; not when over `high`. Between the two the bounds cannot tell, and no value tested
 *  may land there. */
function under(d: bigint, shift: number, low: bigint, high: bigint) {
  if (bitLength(d) + shift > 127) return false
  const scaled = d << BigInt(shift)
  if (scaled >= low && scaled <= high) throw new Error(`${d} · 2^${shift} is too near ln 2`)
  return scaled < low
}

/** The exact `(floor, ceil)` of the correctly rounded `log2 x` for a positive finite `x` (the
 *  bounds are written once, on the Rust side). */
function exact(x: number): [floor: number, ceil: number] {
  const [m, p] = parts(x),
    bits = bitLength(m),
    k = p + bits - 1
  if ((m & (m - 1n)) === 0n) return [k, k]
  const slack = 1n << 20n
  const shiftDown = 64 - bits - halfGap(k + 1, false)
  const floor = k + Number(under((1n << BigInt(bits)) - m, shiftDown, LN2_64 - slack, LN2_64 + 1n))
  const shiftUp = 64 - (bits - 1) - halfGap(k, true)
  const above = m - (1n << BigInt(bits - 1))
  const ceil = k + 1 - Number(under(above, shiftUp, LN2_64, LN2_64 + 1n + slack))
  return [floor, ceil]
}

/** `(floor, ceil)` of `log2 x` as Rust's cast of it gives them: 0 for a NaN or a negative, the
 *  extremes for a zero and an infinity, the exact integers otherwise. */
export function log2Integers(x: number): [floor: number, ceil: number] {
  if (x !== x || x < 0) return [0, 0]
  if (x === 0) return [-(2 ** 31), -(2 ** 31)]
  if (x === Infinity) return [2 ** 31 - 1, 2 ** 31 - 1]
  return exact(x)
}
