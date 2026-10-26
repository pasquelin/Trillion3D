/**
 * Three numbers, a colour's channels or a point's axes, and the matrix applied to one that the
 * colour code on the CPU shares (`aces/`): a column-major 3×3 matrix times a triple, into a new one.
 */
import { applyMatrix3Vector3 } from '../../../math/src/vector/vector.ts'

export type V3 = [number, number, number]

/** `m · v`, `m` column-major 3×3 (`applyMatrix3Vector3`), into a new triple. */
export const times3 = (m: readonly number[], v: readonly number[]) =>
  applyMatrix3Vector3<V3>([0, 0, 0], m, v[0], v[1], v[2])
