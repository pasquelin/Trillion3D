import { BOX_VALUES } from '../primitives/box.ts';
import { frustumExcludesBox } from '../frustum/frustumBox.ts';
import { sphereFromBounds } from '../primitives/sphere.ts';
import { SPHERE_VALUES } from './strides.ts';

/**
 * Tests `n` bounding boxes against the six frustum planes (24 floats), and writes what is KEPT:
 * `kept[i]` is 1 where the box intersects the frustum or sits inside it, 0 where it is excluded.
 * Returns how many were kept. The name says keep because that is what the array holds — it
 * repeats `frustumExcludesBox` negated, which is the polarity Three's `intersectsBox` answers in.
 *
 * Replaces Three's `for … frustum.intersectsBox(box)`.
 */
export function frustumKeepsBoxBatch(
  kept: Uint8Array,
  planes: Float64Array,
  boxes: ArrayLike<number>,
  n: number,
): number {
  let count = 0;
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
    kept[i] = excluded ? 0 : 1;
    if (!excluded) count++;
  }
  return count;
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
