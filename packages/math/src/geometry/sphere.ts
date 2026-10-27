import { boundsAreEmpty, boundsDiagonal, boxCenter } from './box.ts'
import { length3, plainLength3 } from '../vector/vector.ts'

/**
 * Bounding sphere of a box, written flat: centre `x, y, z` then radius, from `o`.
 *
 * The centre is the midpoint of the bounds, `(min + max) * 0.5`; the radius is half the diagonal,
 * `boundsDiagonal · 0.5` (`boxRadius`), the length being `length3`. An empty box — an upper bound
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
  if (boundsAreEmpty(minX, minY, minZ, maxX, maxY, maxZ)) return adopt(out, o, 0, 0, 0, -1)
  boxCenter(out, o, minX, minY, minZ, maxX, maxY, maxZ)
  out[o + 3] = boundsDiagonal(minX, minY, minZ, maxX, maxY, maxZ) * 0.5
}

/** Stores the sphere `(x, y, z, radius)` at `into[at]`: the union's result when one side wins. */
function adopt(into: Float64Array, at: number, x: number, y: number, z: number, radius: number) {
  into[at] = x
  into[at + 1] = y
  into[at + 2] = z
  into[at + 3] = radius
}

/**
 * Grows the sphere stored at `into[at]` (centre, then radius) to the smallest sphere around it and
 * the one read at `sphere[from]`. A negative or NaN radius is an empty sphere: one read is skipped,
 * one held is replaced. When either sphere holds the other, the outer one is kept as is; otherwise
 * the union's diameter runs through both centres, `(d + held + radius) / 2`, its centre moved
 * toward the new sphere by `(next − held) / d` of the gap, `d` the gap's plain root
 * (`plainLength3`), the length of its Rust twin, `merge_spheres` of
 * `packages/math/rust/src/geometry/sphere.rs`, at every distance. The fold of a node's children into its
 * bounds, in the order of the compiler's own merge.
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
    adopt(into, at, cx, cy, cz, radius)
    return
  }
  const dx = cx - into[at],
    dy = cy - into[at + 1],
    dz = cz - into[at + 2]
  const distance = plainLength3(dx, dy, dz)
  if (distance + radius <= held) return
  if (distance + held <= radius) {
    adopt(into, at, cx, cy, cz, radius)
    return
  }
  const next = (distance + held + radius) * 0.5,
    ratio = (next - held) / distance
  into[at] += dx * ratio
  into[at + 1] += dy * ratio
  into[at + 2] += dz * ratio
  into[at + 3] = next
}

/**
 * Whether the sphere stored at `sphere[0..3]` (centre, then radius) meets the cone whose apex is `apex`
 * and whose axis points along `direction` (any length, `unit` its length), its half-angle's sine and
 * cosine `sin` and `cos` (the caller takes them, and the length, once for all the spheres it asks of):
 * the apex is pushed back along the axis so that the sphere lies inside the cone where it touches it,
 * and the sphere's centre must then lie inside the cone; behind the apex the sphere meets the cone only
 * where it holds the apex.
 */
export function sphereMeetsCone(
  sphere: ArrayLike<number>,
  apex: ArrayLike<number>,
  direction: ArrayLike<number>,
  unit: number,
  sin: number,
  cos: number,
) {
  const radius = sphere[3]!
  const dx = sphere[0]! - apex[0]!,
    dy = sphere[1]! - apex[1]!,
    dz = sphere[2]! - apex[2]!
  const distance = length3(dx, dy, dz)
  const push = radius / sin / unit
  const ax = dx + push * direction[0]!,
    ay = dy + push * direction[1]!,
    az = dz + push * direction[2]!
  const along = (direction[0]! * ax + direction[1]! * ay + direction[2]! * az) / unit
  if (!(along > 0 && along * along >= (ax * ax + ay * ay + az * az) * cos * cos)) return false
  const behind = -(direction[0]! * dx + direction[1]! * dy + direction[2]! * dz) / unit
  if (behind > 0 && behind * behind >= distance * distance * sin * sin)
    return distance * distance <= radius * radius
  return true
}
