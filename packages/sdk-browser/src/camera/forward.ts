import { length3 } from '../../../math/src/vector/vector.ts'

/** The unit vector a camera looks along — the third column of its world matrix, negated, made
 *  unit — written into `out`, which it returns. */
export function cameraForward<T extends { [i: number]: number }>(
  out: T,
  world: ArrayLike<number>,
): T {
  const look = length3(world[8], world[9], world[10]) || 1
  for (let i = 0; i < 3; i++) out[i] = -world[8 + i] / look
  return out
}
