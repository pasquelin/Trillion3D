import { boxCenter } from './box.ts'
import { distanceSqVector3, length3 } from '../vector/vector.ts'

/**
 * Bounding sphere of a box, written flat: centre `x, y, z` then radius, from `o`.
 *
 * The centre is the midpoint of the bounds, `(min + max) * 0.5`; the radius is half the diagonal,
 * `‖max − min‖ * 0.5`, the length being `length3`. An empty box — an upper bound
 * below its lower bound — yields the empty sphere, zero centre and radius `-1`. The arithmetic
 * is the box's, term by term: the same bits, NaN, signed zeros and infinities included.
 */
export function sphereFromBounds(
  out: Float64Array,
  o: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  if (maxX < minX || maxY < minY || maxZ < minZ) {
    out[o] = 0
    out[o + 1] = 0
    out[o + 2] = 0
    out[o + 3] = -1
    return
  }
  boxCenter(out, o, minX, minY, minZ, maxX, maxY, maxZ)
  out[o + 3] = length3(maxX - minX, maxY - minY, maxZ - minZ) * 0.5
}

/** True when the sphere of radius `ar` centred at `a[aAt]` and the one of radius `br` at `b[bAt]`
 *  overlap or touch: the squared distance of the centres against the squared sum of the radii. */
export function spheresOverlap(
  a: ArrayLike<number>,
  ar: number,
  b: ArrayLike<number>,
  br: number,
  aAt = 0,
  bAt = 0,
) {
  const s = ar + br
  return distanceSqVector3(a, b, aAt, bAt) <= s * s
}
