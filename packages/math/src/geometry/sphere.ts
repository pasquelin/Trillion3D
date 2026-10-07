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

/**
 * Grows the sphere stored at `into[at]` (centre, then radius) to the smallest sphere around it and
 * the one read at `sphere[from]`. A negative or NaN radius is an empty sphere: one read is skipped,
 * one held is replaced. When either sphere holds the other, the outer one is kept as is; otherwise
 * the union's diameter runs through both centres, `(d + held + radius) / 2`, its centre moved
 * toward the new sphere by `(next − held) / d` of the gap, `d` the gap's `length3`. The fold of a
 * node's children into its bounds, in the order of the compiler's own merge; its Rust twin is
 * `merge_spheres` of `packages/math/rust/src/sphere.rs`.
 */
export function sphereUnion(
  into: Float64Array,
  at: number,
  sphere: ArrayLike<number>,
  from: number,
) {
  const radius = sphere[from + 3]
  if (!(radius >= 0)) return
  const cx = sphere[from],
    cy = sphere[from + 1],
    cz = sphere[from + 2]
  const held = into[at + 3]
  if (!(held >= 0)) {
    into[at] = cx
    into[at + 1] = cy
    into[at + 2] = cz
    into[at + 3] = radius
    return
  }
  const dx = cx - into[at],
    dy = cy - into[at + 1],
    dz = cz - into[at + 2]
  const distance = length3(dx, dy, dz)
  if (distance + radius <= held) return
  if (distance + held <= radius) {
    into[at] = cx
    into[at + 1] = cy
    into[at + 2] = cz
    into[at + 3] = radius
    return
  }
  const next = (distance + held + radius) * 0.5,
    ratio = (next - held) / distance
  into[at] += dx * ratio
  into[at + 1] += dy * ratio
  into[at + 2] += dz * ratio
  into[at + 3] = next
}
