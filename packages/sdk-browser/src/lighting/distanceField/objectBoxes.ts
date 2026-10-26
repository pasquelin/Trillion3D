import { BOX_VALUES, boxUnion } from '../../../../math/src/geometry/box.ts'

/** THE BOXES OF PLACEMENTS COMPARED, in centimetres, as the tracker decides what a change names. */

export const halfExtent = (box: ArrayLike<number>, k: number) => 0.5 * (box[3 + k] - box[k])

/** The box that holds both, and whether it grows no half-extent by 100 over the two. */
export function holding(a: Float64Array, b: Float64Array) {
  const box = a.slice(0, BOX_VALUES)
  boxUnion(box, 0, b[0], b[1], b[2], b[3], b[4], b[5])
  const near = [0, 1, 2].every(
    (k) => halfExtent(box, k) - halfExtent(a, k) - halfExtent(b, k) < 100,
  )
  return { box, near }
}
