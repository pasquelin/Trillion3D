import { length3 } from '../../../../math/src/vector/vector.ts'

/** The shader's draw-distance arithmetic (`shader/drawDistanceWgsl.ts`) on the CPU, in the same order: the oracle a test runs the
 *  shipped shader against. */

/** Whether an object whose bounds' sphere, of radius `radius`, centres `distance` from the main
 *  view's eye is out of its distances, `near` to `far` times `scale`: its nearest point farther
 *  than the farthest, its farthest point nearer than the nearest. A `far` or a `near` of 0 or less
 *  names none of its end; a radius of 0 tests the centre. */
export function outsideDrawDistances(
  distance: number,
  radius: number,
  near: number,
  far: number,
  scale: number,
) {
  const closest = Math.max(distance - radius, 0),
    furthest = distance + radius
  return (far > 0 && closest > far * scale) || (near > 0 && furthest < near * scale)
}

/** The radius of the sphere of a box of half extents `half`, in a placement's space, in the world
 *  `m` puts it in (sixteen column-major numbers): the half diagonal at the greatest of the lengths
 *  of the matrix's rows, held to the half diagonal of the box `m` makes of it — the form a
 *  transformed bounding box takes, where an uneven scale makes the first the larger
 *  (`drawSphereRadius` in `shader/drawDistanceWgsl.ts`). */
export function drawSphereRadius(m: ArrayLike<number>, half: ArrayLike<number>) {
  const h0 = half[0],
    h1 = half[1],
    h2 = half[2]
  const rows = Math.max(
    0,
    m[0] ** 2 + m[4] ** 2 + m[8] ** 2,
    m[1] ** 2 + m[5] ** 2 + m[9] ** 2,
    m[2] ** 2 + m[6] ** 2 + m[10] ** 2,
  )
  const e0 = Math.abs(m[0]) * h0 + Math.abs(m[4]) * h1 + Math.abs(m[8]) * h2,
    e1 = Math.abs(m[1]) * h0 + Math.abs(m[5]) * h1 + Math.abs(m[9]) * h2,
    e2 = Math.abs(m[2]) * h0 + Math.abs(m[6]) * h1 + Math.abs(m[10]) * h2
  return Math.min(length3(h0, h1, h2) * Math.sqrt(rows), length3(e0, e1, e2))
}
