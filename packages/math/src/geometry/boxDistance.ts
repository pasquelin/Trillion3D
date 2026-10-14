import { length3 } from '../vector/vector.ts'

/** Distance from the point `(x, y, z)` to the box at `box[o]`, 0 inside it: the gap past each face,
 *  the distance of the clamped point. */
export function boxPointDistance(
  box: ArrayLike<number>,
  o: number,
  x: number,
  y: number,
  z: number,
) {
  const dx = Math.max(box[o] - x, 0, x - box[o + 3]),
    dy = Math.max(box[o + 1] - y, 0, y - box[o + 4]),
    dz = Math.max(box[o + 2] - z, 0, z - box[o + 5])
  return length3(dx, dy, dz)
}

/** Distance from the point `(x, y, z)` to the farthest corner of the box at `box[o]`: on each axis
 *  the bound farther from the point. Every point of the box lies within it. */
export function boxPointReach(box: ArrayLike<number>, o: number, x: number, y: number, z: number) {
  const dx = Math.max(Math.abs(x - box[o]), Math.abs(x - box[o + 3])),
    dy = Math.max(Math.abs(y - box[o + 1]), Math.abs(y - box[o + 4])),
    dz = Math.max(Math.abs(z - box[o + 2]), Math.abs(z - box[o + 5]))
  return length3(dx, dy, dz)
}
