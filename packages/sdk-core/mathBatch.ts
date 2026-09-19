import { BOX_VALUES, boxTransform } from './mathBox.ts';
import { multiplyMatrix4 } from './mathMatrix4.ts';
import { composeMatrix4 } from './mathMatrix4Trs.ts';

/**
 * Math foundation operations executed IN BATCHES: `n` flat elements, a single function
 * entry, no allocation. This is the reference JavaScript path and fallback path:
 * WebAssembly kernels in `packages/page-codec-wasm/src/math.rs` replicate these loops term by
 * term, and the governor (`mathPathGovernor.ts`) selects which of the two runs.
 *
 * Matrices are passed as SUB-VIEWS of sixteen numbers, not offsets: `multiplyMatrix4` and
 * `boxCornersInto` read their inputs at constant indices, and a parameter offset would
 * make them computed — measured at 6% of full product (`mathMatrix4.ts`). Sub-views are
 * constructed once per batch, as the hierarchy already holds `worldViews` on `world`.
 */

/** Floats of a flat 4×4 matrix. */
export const MATRIX_VALUES = 16;

/**
 * `n` boxes transformed by `n` matrices: `out[i] = boxTransform(boxes[i], mats[i])`. `out` and
 * `boxes` carry six numbers per element, `mats` a sub-view of sixteen per element.
 */
export function boxTransformBatch(
  out: Float64Array,
  boxes: ArrayLike<number>,
  mats: readonly ArrayLike<number>[],
  n: number,
) {
  for (let i = 0; i < n; i++) {
    const at = i * BOX_VALUES;
    boxTransform(out, at, boxes, at, mats[i]);
  }
}

/** `n` products `out[i] = a[i] · b[i]`, all three sides given as sub-views of sixteen numbers. */
export function multiplyMatrix4Batch(
  out: readonly Float64Array[],
  a: readonly Float64Array[],
  b: readonly Float64Array[],
  n: number,
) {
  for (let i = 0; i < n; i++) multiplyMatrix4(out[i], a[i], b[i]);
}

/** Floats of a position or scale, and a quaternion `(x, y, z, w)`, stored flat. */
export const POSITION_VALUES = 3;
export const QUATERNION_VALUES = 4;

/**
 * FULL HIERARCHY updated in one pass: `n` nodes ordered parents before children, each
 * composing its local matrix then multiplying it by its parent's world matrix. This is the
 * traversal in `mathTransformTreeUpdate.ts`, with the exact same two formulas in the same order, on
 * flat buffers: the WebAssembly kernel replicates it term by term.
 *
 * `parents[i]` MUST be the index of an already updated node, hence strictly less than `i`; any
 * other value — sentinel `HIERARCHY_ROOT` included — makes the node a root whose world
 * matrix is its local matrix. The rule is identical on both sides: no input, however
 * hostile, can cause them to diverge.
 */
export const HIERARCHY_ROOT = 0xffffffff;

export function hierarchyUpdateBatch(
  worldViews: readonly Float64Array[],
  positions: readonly Float64Array[],
  rotations: readonly Float64Array[],
  scales: readonly Float64Array[],
  parents: Uint32Array,
  n: number,
  local: Float64Array,
) {
  for (let i = 0; i < n; i++) {
    composeMatrix4(local, positions[i], rotations[i], scales[i]);
    const parent = parents[i],
      world = worldViews[i];
    // Single loop: `TypedArray.prototype.set` on a view costs a native call.
    if (parent >= i) for (let k = 0; k < MATRIX_VALUES; k++) world[k] = local[k];
    else multiplyMatrix4(world, worldViews[parent], local);
  }
}
