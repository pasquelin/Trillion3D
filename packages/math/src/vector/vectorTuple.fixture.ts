// Tuple arithmetic the tests and the GPU proofs build their expectations with (`vectorTuple.ts`
// holds the engine's own).
import { addVector3, dotVector3 } from './vector.ts'
import type { Vec3 } from './vectorTuple.ts'

/** A sum in a fresh tuple. */
export const add = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 =>
  addVector3<Vec3>([0, 0, 0], a, b)
/** `a` times `s` in a fresh tuple. */
export const scale = (a: ArrayLike<number>, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
/** The direction `d` reflected about the unit normal `n`, `d − 2(d·n)n` (WGSL’s `reflect`), in a
 *  fresh tuple. */
export const reflect = (d: ArrayLike<number>, n: ArrayLike<number>): Vec3 => {
  const k = 2 * dotVector3(d, n)
  return [d[0] - k * n[0], d[1] - k * n[1], d[2] - k * n[2]]
}
