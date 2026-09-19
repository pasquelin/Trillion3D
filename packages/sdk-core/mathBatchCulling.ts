import { BOX_VALUES } from './mathBox.ts';
import { frustumExcludesBox } from './mathFrustumBox.ts';
import { sphereFromBounds } from './mathSphere.ts';

/** Floats of a bounding sphere (x, y, z, radius) stored flat. */
export const SPHERE_VALUES = 4;

/**
 * Tests `n` bounding boxes against the 6 frustum planes (24 floats).
 *
 * For each box, `out[i]` receives 1 if the box is kept (intersects or inside the frustum),
 * or 0 if excluded. Returns the total count of kept boxes.
 *
 * Repeats `frustumExcludesBox`. Replaces Three.js loop: `for … frustum.intersectsBox(box)`.
 */
export function frustumExcludesBoxBatch(
  out: Uint8Array,
  planes: Float64Array,
  boxes: ArrayLike<number>,
  n: number,
): number {
  let kept = 0;
  for (let i = 0; i < n; i++) {
    const at = i * BOX_VALUES;
    const excluded = frustumExcludesBox(
      planes,
      boxes[at],
      boxes[at + 1],
      boxes[at + 2],
      boxes[at + 3],
      boxes[at + 4],
      boxes[at + 5],
    );
    if (!excluded) {
      out[i] = 1;
      kept++;
    } else {
      out[i] = 0;
    }
  }
  return kept;
}

/**
 * Computes bounding spheres for `n` boxes. `out` receives 4 floats per element
 * (centre x, y, z, radius).
 *
 * Repeats `sphereFromBounds`. Replaces Three.js loop: `for … box.getBoundingSphere(s)`.
 */
export function sphereFromBoundsBatch(
  out: Float64Array,
  boxes: ArrayLike<number>,
  n: number,
): void {
  for (let i = 0; i < n; i++) {
    const src = i * BOX_VALUES;
    sphereFromBounds(
      out,
      i * SPHERE_VALUES,
      boxes[src],
      boxes[src + 1],
      boxes[src + 2],
      boxes[src + 3],
      boxes[src + 4],
      boxes[src + 5],
    );
  }
}
