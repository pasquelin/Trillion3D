import { writeDividedVector3 } from '../../../math/src/vector/vector.ts'

/** The unit vector a camera looks along — the third column of its world matrix, negated, made
 *  unit — written into `out`, which it returns. */
export function cameraForward<T extends { [i: number]: number }>(
  out: T,
  world: ArrayLike<number>,
): T {
  writeDividedVector3(out, 0, -world[8], -world[9], -world[10])
  return out
}
