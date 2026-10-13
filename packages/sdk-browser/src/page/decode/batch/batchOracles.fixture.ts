import { BOX_VALUES, boxTransform } from '../../../../../math/src/geometry/box.ts'
import { multiplyMatrix4 } from '../../../../../math/src/matrix/matrix4.ts'
import { MATRIX_VALUES } from '../../../../../math/src/batch/strides.ts'

/**
 * The oracles of the two batch kernels the lots run (`batchRuntime.ts`, over
 * `packages/page-codec-wasm/src/math.rs`): each element taken alone by its single-element
 * function, on the lots' flat layout — six numbers a box, sixteen a matrix. The tests and the
 * bench compare the kernels' bits with these; no engine path runs them.
 */

/** The sixteen numbers of element `i` of the flat matrices `values`. */
const matrixAt = (values: Float64Array, i: number) =>
  values.subarray(i * MATRIX_VALUES, (i + 1) * MATRIX_VALUES)

/** Each of the first `n` boxes of `boxes` moved alone by its matrix of `mats` (`boxTransform`). */
export function boxesByLoop(boxes: Float64Array, mats: Float64Array, n: number) {
  const out = new Float64Array(n * BOX_VALUES)
  for (let i = 0; i < n; i++)
    boxTransform(out, i * BOX_VALUES, boxes, i * BOX_VALUES, matrixAt(mats, i))
  return out
}

/** Each of the first `n` products of `a` and `b` taken alone (`multiplyMatrix4`). */
export function productsByLoop(a: Float64Array, b: Float64Array, n: number) {
  const out = new Float64Array(n * MATRIX_VALUES)
  for (let i = 0; i < n; i++) multiplyMatrix4(matrixAt(out, i), matrixAt(a, i), matrixAt(b, i))
  return out
}
