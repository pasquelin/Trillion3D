/**
 * Orientation of a world transformation, sixteen numbers input and nothing else: no Three, no
 * GPU, no DOM. Stored here alongside `maxStretch`, it tests without a browser and the CPU
 * visbuffer rasterizer no longer needs to import it from a `webgpu*` module.
 */
import { linearPartDeterminant } from './matrix4.ts';

/**
 * Does the transformation flip orientation? The determinant of the 3x3 of a world matrix
 * is negative, so the culled face is the opposite one.
 *
 * `elements` is a 4x4 stored column-major like standard 3D libraries: the linear part
 * occupies indices 0,1,2 / 4,5,6 / 8,9,10. With the last row of an affine world matrix equal to
 * (0, 0, 0, 1), this 3x3 determinant IS that of the 4x4: the three cofactors of the last row
 * are multiplied by zero. Nine multiplications instead of ~30, yielding the exact same verdict —
 * except on a matrix singular up to rounding error, which flattens the primitive onto a plane or
 * line and no longer has a face to show.
 *
 * This determinant is written once in `linearPartDeterminant` of the math foundation:
 * same products, same sums, same order, hence the same sign down to identical bits.
 */
export function matrixWindingCw(elements: ArrayLike<number>) {
  return linearPartDeterminant(elements) < 0;
}
