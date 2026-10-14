// Measure a discrepancy, not just observe it. Certain optimizations reorder
// floating point operations: this file counts differing values and states by how much, in ULP
// (`ulpBetween`), so that the table displays a number where strict equality would only show a "no".
import { ulpBetween } from '../../packages/math/src/float/ulp.fixture.ts'

/** How many values differ, by at most how many ULP, and the first discrepancy seen. */
export interface Counter {
  count: number
  ulpMax: number
  premier: string | null
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
