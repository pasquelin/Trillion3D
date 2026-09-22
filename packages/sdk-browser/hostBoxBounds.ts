/**
 * The local box a host geometry carries, read by its two corners into a flat array.
 *
 * Reading a box is not a computation and needs no rendering library: a host box is two points,
 * and the engine copies their six numbers. Volumes themselves are computed in `mathBox.ts` and
 * `mathSphere.ts`. Writing a box back INTO a host geometry is the opposite crossing and belongs
 * to the boundary that owns the library, `threeBounds.ts`.
 */
import type { HostPoint } from './hostResources.ts';

/** A local or world box of the host, read by its two corners. */
export type HostBox = { readonly min: HostPoint; readonly max: HostPoint };

/** Copy the six bounds of a host box into a flat array. */
export function readHostBox(out: Float64Array, box: HostBox) {
  out[0] = box.min.x;
  out[1] = box.min.y;
  out[2] = box.min.z;
  out[3] = box.max.x;
  out[4] = box.max.y;
  out[5] = box.max.z;
}
