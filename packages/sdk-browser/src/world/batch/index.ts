import {
  composeMatrix4Batch,
  frustumKeepsBoxBatch,
  multiplyMatrix4Batch,
  transformPointsBatch,
} from '../../../../sdk-core/src/index.ts';

/** The float arrays a batch reads and writes. */
export type FloatBatch = Float32Array | Float64Array;

/** Sixteen-number views of a flat run of matrices, in double precision as the core multiplies. */
const views = (flat: FloatBatch, count: number) => {
  const doubles = flat instanceof Float64Array ? flat : Float64Array.from(flat);
  return Array.from({ length: count }, (_, i) => doubles.subarray(i * 16, i * 16 + 16));
};

/**
 * The `batch` family: a thousand matrices at once instead of a loop, over the core's batched
 * kernels (`packages/sdk-core/src/math/batch/batch.ts`, `packages/sdk-core/src/math/batch/points.ts`, `packages/sdk-core/src/math/matrix/matrix4Compose.ts`, `packages/sdk-core/src/math/batch/culling.ts`).
 */
export const batch = {
  /**
   * `out[i] = a[i] · b[i]` for `count` column-major matrices stored flat.
   * @param out - Where the products go.
   * @param a - The left matrices.
   * @param b - The right matrices.
   * @param count - How many products.
   */
  multiplyMatrix4(out: FloatBatch, a: FloatBatch, b: FloatBatch, count: number) {
    const products = views(new Float64Array(count * 16), count);
    multiplyMatrix4Batch(products, views(a, count), views(b, count), count);
    products.forEach((m, i) => out.set(m, i * 16));
  },
  /**
   * `out[i] = m · points[i]` for `count` points stored three numbers each.
   * @param out - Where the moved points go.
   * @param points - The points.
   * @param m - The matrix.
   * @param count - How many points.
   */
  transformPoints(
    out: Float32Array,
    points: Float32Array,
    m: FloatBatch | { elements: FloatBatch },
    count: number,
  ) {
    transformPointsBatch(out, 'elements' in m ? m.elements : m, points, count);
  },
  /**
   * `out[i] = T(positions[i]) · R(quaternions[i]) · S(scales[i])` for `count` poses.
   * @param out - Where the matrices go.
   * @param positions - The positions.
   * @param quaternions - The rotations.
   * @param scales - The sizes.
   * @param count - How many matrices.
   */
  composeMatrix4(
    out: FloatBatch,
    positions: Float32Array,
    quaternions: Float32Array,
    scales: Float32Array,
    count: number,
  ) {
    composeMatrix4Batch(out, positions, quaternions, scales, count);
  },
  /**
   * `out[i] = 1` where the `i`-th box (six numbers) is not outside the frustum.
   * @param out - One flag per box: 1 kept, 0 dropped.
   * @param frustum - The six planes.
   * @param boxes - The boxes.
   * @param count - How many boxes.
   */
  frustumKeepsBox(
    out: Uint8Array,
    frustum: { planes: Float64Array },
    boxes: Float32Array,
    count: number,
  ) {
    frustumKeepsBoxBatch(out, frustum.planes, boxes, count);
  },
};
