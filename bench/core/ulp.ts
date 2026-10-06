// Measure a discrepancy, not just observe it. Certain optimizations reorder
// floating point operations: this file counts differing values and states by how much, in ULP,
// so that the table displays a number where strict equality would only show a "no".

/** How many values differ, by at most how many ULP, and the first discrepancy seen. */
export interface Counter {
  count: number
  ulpMax: number
  premier: string | null
}

const view = new DataView(new ArrayBuffer(8))

/**
 * Monotonic rank of a float in bit order: difference of two ranks is ULP discrepancy.
 * 32-bit rank fits in a double int, so no `BigInt` on this path — it is used by
 * images and `Float32Array`, called hundreds of thousands of times during comparison.
 */
function rang32(x: number) {
  view.setFloat32(0, x)
  const b = view.getInt32(0)
  return b < 0 ? -2147483648 - b : b
}

function rang64(x: number) {
  view.setFloat64(0, x)
  const b = view.getBigInt64(0)
  return b < 0n ? -9223372036854775808n - b : b
}

/** ULP discrepancy between two floats. `Infinity` as soon as NaN or infinity is not shared. */
function ulpBetween(a: number, b: number, bits = 64) {
  if (Object.is(a, b)) return 0
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity
  if (bits === 32) return Math.abs(rang32(a) - rang32(b))
  const d = rang64(a) - rang64(b)
  return Number(d < 0n ? -d : d)
}

/** Discrepancy counter: how many values differ, by at most how many ULP, and first seen. */
export function counter(): Counter {
  return { count: 0, ulpMax: 0, premier: null }
}

export function note(c: Counter, a: number, b: number, path: string, bits = 64) {
  if (Object.is(a, b)) return
  c.count++
  const u = ulpBetween(a, b, bits)
  if (u > c.ulpMax) c.ulpMax = u
  c.premier ??= `${path}: ${String(a)} ≠ ${String(b)} (${u} ULP)`
}
