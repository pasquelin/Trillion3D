import { boxTransform } from '../../../../sdk-core/src/index.ts'

// Eight binary32 unit roundoffs cover WGSL division's allowed error as well as separate
// multiply/add evaluation. Products/sums accumulate by gamma(n), not a fixed world-space epsilon.
export const ROUND = 8 * 2 ** -24
const GAMMA = (8 * ROUND) / (1 - 8 * ROUND)
const FLUSH = 8 * 2 ** -126

/** Include conversion, arithmetic and permitted subnormal flushing in a coordinate interval. */
export function widenBox(box: Float64Array, distance = 0) {
  for (let axis = 0; axis < 3; axis++) {
    const error = Math.max(Math.abs(box[axis]), Math.abs(box[axis + 3])) * GAMMA + FLUSH
    box[axis] -= distance + error
    box[axis + 3] += distance + error
  }
}

/** Enclose a binary32 homogeneous transform using the existing box transform, with absolute
 * product-sum error bounds. A denominator interval reaching zero, overflow or nonfinite input
 * refuses cropping. `error` is also the enlargement of the nominal divided coordinates. */
export function encloseTransform(
  out: Float64Array,
  box: Float64Array,
  matrix: ArrayLike<number>,
  error: Float64Array,
) {
  if (!box.every(Number.isFinite)) return false
  for (let axis = 0; axis < 3; axis++) if (box[axis] > box[axis + 3]) return false
  let minimumW = matrix[15],
    maximumW = matrix[15],
    magnitudeW = Math.abs(matrix[15])
  for (let axis = 0; axis < 3; axis++) {
    const a = matrix[axis * 4 + 3] * box[axis]
    const b = matrix[axis * 4 + 3] * box[axis + 3]
    minimumW += Math.min(a, b)
    maximumW += Math.max(a, b)
    magnitudeW += Math.max(Math.abs(a), Math.abs(b))
  }
  const errorW = GAMMA * magnitudeW + FLUSH
  if (!(minimumW > errorW) || !Number.isFinite(maximumW)) return false
  boxTransform(out, 0, box, 0, matrix)
  for (let axis = 0; axis < 3; axis++) {
    let magnitude = Math.abs(matrix[12 + axis])
    for (let column = 0; column < 3; column++)
      magnitude +=
        Math.abs(matrix[column * 4 + axis]) *
        Math.max(Math.abs(box[column]), Math.abs(box[column + 3]))
    if (!(magnitude < 3.4028234663852886e38)) return false
    const bound = Math.max(Math.abs(out[axis]), Math.abs(out[axis + 3]))
    error[axis] = (GAMMA * magnitude + FLUSH + bound * errorW) / (minimumW - errorW) + ROUND * bound
    out[axis] -= error[axis]
    out[axis + 3] += error[axis]
  }
  return out.every(Number.isFinite)
}
