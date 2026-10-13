import { BOX_VALUES, boxTransform, boxUnion } from '../geometry/box.ts'

/**
 * Math foundation operations executed IN BATCHES: `n` flat elements, a single function
 * entry, no allocation. A box moved by its matrix and a matrix product in batches are the
 * WebAssembly kernels' alone (`packages/page-codec-wasm/src/math.rs`, over `packages/math/rust`'s
 * `matrix.rs` and `box_transform.rs`), which the engine's lots run
 * (`packages/sdk-browser/src/page/decode/batch/batchRuntime.ts`): no JavaScript loop beside them.
 *
 * Matrices are passed as SUB-VIEWS of sixteen numbers, not offsets: `multiplyMatrix4` and
 * `boxCornersInto` read their inputs at constant indices, and a parameter offset would
 * make them computed — measured at 6% of full product (`../matrix/matrix4.ts`). Sub-views are
 * constructed once per batch, as the hierarchy already holds `worldViews` on `world`.
 *
 * The kernels this file does not hold are grouped by subject in `mathBatch*.ts` and re-exported
 * here, so a host imports one name: the 200-line limit is what splits them, not their contract.
 */

export {
  MATRIX_VALUES,
  NORMAL_MATRIX_VALUES,
  POSITION_VALUES,
  QUATERNION_VALUES,
  SPHERE_VALUES,
} from './strides.ts'
export { frustumKeepsBoxBatch, sphereFromBoundsBatch } from './culling.ts'
export {
  composeMatrix4Batch,
  decomposeMatrix4Batch,
  invertMatrix4Batch,
  normalMatrix3Batch,
} from './transforms.ts'
export {
  transformDirectionsBatch,
  transformPointsBatch,
  transformPointsByMatricesBatch,
} from './points.ts'
export { linearToSrgbBatch, srgbToLinearBatch } from './color.ts'

/**
 * Reduces `n` bounding boxes into `into` by progressive union: `into = into ∪ boxes[0] ∪ … ∪ boxes[n - 1]`.
 * `into` carries six numbers, `boxes` carries six numbers per element flat.
 *
 * Repeats `boxUnion`.
 */
export function boxUnionBatch(into: Float64Array, boxes: ArrayLike<number>, n: number): void {
  for (let i = 0; i < n; i++) {
    const at = i * BOX_VALUES
    boxUnion(
      into,
      0,
      boxes[at],
      boxes[at + 1],
      boxes[at + 2],
      boxes[at + 3],
      boxes[at + 4],
      boxes[at + 5],
    )
  }
}

const scratchUnionBox = new Float64Array(BOX_VALUES)

/**
 * Transforms `n` boxes by `n` matrices and unites them into `into` in a single pass without allocation.
 *
 * Repeats `boxTransform` then `boxUnion`. One box around many objects.
 */
export function boxTransformUnionBatch(
  into: Float64Array,
  boxes: ArrayLike<number>,
  mats: readonly ArrayLike<number>[],
  n: number,
): void {
  for (let i = 0; i < n; i++) {
    const at = i * BOX_VALUES
    boxTransform(scratchUnionBox, 0, boxes, at, mats[i])
    boxUnion(
      into,
      0,
      scratchUnionBox[0],
      scratchUnionBox[1],
      scratchUnionBox[2],
      scratchUnionBox[3],
      scratchUnionBox[4],
      scratchUnionBox[5],
    )
  }
}
