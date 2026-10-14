import { BOX_VALUES, boxUnion } from '../geometry/box.ts'

/**
 * Math foundation operations executed IN BATCHES: `n` flat elements, a single function
 * entry, no allocation. Boxes moved by their matrices and matrix products in batches are the
 * WebAssembly kernels' alone (`packages/page-codec-wasm/src/math.rs`, over `packages/math/rust`'s
 * `matrix.rs` and `box_transform.rs`), which the engine's lots run
 * (`packages/sdk-browser/src/page/decode/batch/batchRuntime.ts`): no JavaScript loop beside them,
 * a union of moved boxes included — the lot moves them, `boxUnionBatch` unites its output.
 *
 * Matrices are passed as SUB-VIEWS of sixteen numbers, not offsets: `multiplyMatrix4` and
 * `boxCornersInto` read their inputs at constant indices, and a parameter offset would
 * make them computed — measured at 6% of full product (`../matrix/matrix4.ts`). Sub-views are
 * constructed once per batch, as the hierarchy already holds `worldViews` on `world`.
 *
 * The other batch kernels live by subject beside this file (`strides.ts`, `culling.ts`,
 * `points.ts`, `../matrix/matrix4Compose.ts`); a host imports each from
 * its own module, and the package entry (`../index.ts`) names them all.
 */

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
