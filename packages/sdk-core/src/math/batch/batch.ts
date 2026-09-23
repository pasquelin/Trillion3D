import { BOX_VALUES, boxTransform, boxUnion } from '../primitives/box.ts';
import { MATRIX_VALUES } from './strides.ts';
import { multiplyMatrix4 } from '../matrix/matrix4.ts';
import { composeMatrix4 } from '../matrix/matrix4Trs.ts';

/**
 * Math foundation operations executed IN BATCHES: `n` flat elements, a single function
 * entry, no allocation. This is the reference JavaScript path and fallback path:
 * WebAssembly kernels in `packages/page-codec-wasm/src/math.rs` replicate these loops term by
 * term, and the governor (`../path/governor.ts`) selects which of the two runs.
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
} from './strides.ts';
export { frustumKeepsBoxBatch, sphereFromBoundsBatch } from './culling.ts';
export {
  composeMatrix4Batch,
  decomposeMatrix4Batch,
  invertMatrix4Batch,
  normalMatrix3Batch,
} from './transforms.ts';
export {
  transformDirectionsBatch,
  transformPointsBatch,
  transformPointsByMatricesBatch,
} from './points.ts';
export { linearToSrgbBatch, srgbToLinearBatch } from './color.ts';

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

/**
 * Reduces `n` bounding boxes into `into` by progressive union: `into = into ∪ boxes[0] ∪ … ∪ boxes[n - 1]`.
 * `into` carries six numbers, `boxes` carries six numbers per element flat.
 *
 * Repeats `boxUnion`. Replaces Three.js loop: `for … box.union(b)`.
 */
export function boxUnionBatch(into: Float64Array, boxes: ArrayLike<number>, n: number): void {
  for (let i = 0; i < n; i++) {
    const at = i * BOX_VALUES;
    boxUnion(
      into,
      0,
      boxes[at],
      boxes[at + 1],
      boxes[at + 2],
      boxes[at + 3],
      boxes[at + 4],
      boxes[at + 5],
    );
  }
}

const scratchUnionBox = new Float64Array(BOX_VALUES);

/**
 * Transforms `n` boxes by `n` matrices and unites them into `into` in a single pass without allocation.
 *
 * Repeats `boxTransform` then `boxUnion`. Replaces Three.js loop: `Box3.setFromObject`.
 */
export function boxTransformUnionBatch(
  into: Float64Array,
  boxes: ArrayLike<number>,
  mats: readonly ArrayLike<number>[],
  n: number,
): void {
  for (let i = 0; i < n; i++) {
    const at = i * BOX_VALUES;
    boxTransform(scratchUnionBox, 0, boxes, at, mats[i]);
    boxUnion(
      into,
      0,
      scratchUnionBox[0],
      scratchUnionBox[1],
      scratchUnionBox[2],
      scratchUnionBox[3],
      scratchUnionBox[4],
      scratchUnionBox[5],
    );
  }
}

/**
 * FULL HIERARCHY updated in one pass: `n` nodes ordered parents before children, each
 * composing its local matrix then multiplying it by its parent's world matrix. This is the
 * traversal in `../transform-tree/update.ts`, with the exact same two formulas in the same order, on
 * flat buffers: the WebAssembly kernel replicates it term by term.
 *
 * `parents[i]` MUST be the index of an already updated node, hence strictly less than `i`; any
 * other value — sentinel `HIERARCHY_ROOT` included — makes the node a root whose world
 * matrix is its local matrix. The rule is identical on both sides: no input, however
 * hostile, can cause them to diverge.
 */
export const HIERARCHY_ROOT = 0xffffffff;

/** Computes the world matrices of a whole hierarchy in one pass, parents first. */
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
