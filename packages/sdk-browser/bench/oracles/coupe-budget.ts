// Oracles of the WebGL2 cut from before batch 4c: the general path, the one that projects.
// Unit tests import them to check that the zero-threshold paths yield the exact same
// decision, and that the shared distance does not change a bit.
import { clusterErrorPixels } from '../../../sdk-core/index.ts';
import type { ClusterCut } from '../../pageSelectionMath.ts';

/** Bound-array offsets read at fixed slots, as `pageSelectionCutBounds.ts` lays them out. */
interface BoundSlots {
  ownFloor: number;
  ownCeil: number;
  parentFloor: number;
  ownSphere: number;
  parentSphere: number;
}

/** `pageSelectionMath.ts` before batch 4c: the centre projected into a shared buffer. */
const centre = new Float64Array(3);
export function referenceProjectCentre(
  sphere: ArrayLike<number>,
  offset: number,
  e: ArrayLike<number>,
) {
  const cx = sphere[offset],
    cy = sphere[offset + 1],
    cz = sphere[offset + 2];
  centre[0] = e[0] * cx + e[4] * cy + e[8] * cz + e[12];
  centre[1] = e[1] * cx + e[5] * cy + e[9] * cz + e[13];
  centre[2] = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
  return centre;
}

/** `projectedClusterError` from before batch 4c: one square root per bound, in `clusterErrorPixels`. */
export function referenceProjectedClusterError(
  error: number | null | undefined,
  sphere: ArrayLike<number> | null | undefined,
  offset: number,
  e: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
) {
  if (error === 0) return 0;
  if (error == null || error === Infinity) return Infinity;
  if (!sphere) return Infinity;
  const c = referenceProjectCentre(sphere, offset, e);
  return clusterErrorPixels(error, stretch, c[0], c[1], c[2], sphere[offset + 3], focal, near);
}

/** `errorFloorPixels` from before batch 4c, on the depth that defect-3's corrected bound
 *  uses (`−vue(C).z`) where the old one took the distance to the eye: the floor stays the
 *  lower bound of a subtree; the proof is at the `errorFloorAt` site. */
export function referenceErrorFloorPixels(
  error: number | null | undefined,
  stretch: number,
  c: ArrayLike<number>,
  radius: number,
  focal: number,
) {
  if (error === 0) return 0;
  if (error == null) return 0;
  if (error === Infinity) return Infinity;
  if (!(error > 0) || !(radius >= 0)) return 0;
  const far = -c[2] + radius * stretch;
  if (!(far > 0)) return Infinity;
  return (error * stretch * focal) / far;
}

/** `cutSelects` from before batch 4c: two projections, whatever the threshold. */
export function referenceCutSelects(
  rec: ClusterCut,
  e: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
  pixelError: number,
) {
  if (
    referenceProjectedClusterError(rec.lodError ?? 0, rec.sphere, 0, e, stretch, focal, near) >
    pixelError
  )
    return false;
  return (
    referenceProjectedClusterError(
      rec.parentError,
      rec.parentSphere ?? rec.sphere,
      0,
      e,
      stretch,
      focal,
      near,
    ) > pixelError
  );
}

/** `nodeDecision` from before batch 4c, bounds read at the same offsets. */
export function referenceNodeDecision(
  values: ArrayLike<number>,
  at: number,
  slots: BoundSlots,
  e: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
  limit: number,
) {
  const { ownFloor, ownCeil, parentFloor, ownSphere, parentSphere } = slots;
  const own = referenceProjectCentre(values, at + ownSphere, e),
    radius = values[at + ownSphere + 3];
  if (referenceErrorFloorPixels(values[at + ownFloor], stretch, own, radius, focal) > limit)
    return -1;
  if (
    clusterErrorPixels(values[at + ownCeil], stretch, own[0], own[1], own[2], radius, focal, near) >
    limit
  )
    return 0;
  const band = referenceProjectCentre(values, at + parentSphere, e);
  return referenceErrorFloorPixels(
    values[at + parentFloor],
    stretch,
    band,
    values[at + parentSphere + 3],
    focal,
  ) > limit
    ? 1
    : 0;
}
