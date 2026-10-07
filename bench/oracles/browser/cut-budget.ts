// Oracles of the cut from before batch 4c: the general path, the one that projects.
// Unit tests import them to check that the shared distance does not change a bit.
import { clusterErrorPixels } from '../../../packages/sdk-core/src/index.ts'

/** `packages/sdk-browser/src/page/selection/math.ts` before batch 4c: the centre projected into a shared buffer. */
const centre = new Float64Array(3)
export function referenceProjectCentre(
  sphere: ArrayLike<number>,
  offset: number,
  e: ArrayLike<number>,
) {
  const cx = sphere[offset],
    cy = sphere[offset + 1],
    cz = sphere[offset + 2]
  centre[0] = e[0] * cx + e[4] * cy + e[8] * cz + e[12]
  centre[1] = e[1] * cx + e[5] * cy + e[9] * cz + e[13]
  centre[2] = e[2] * cx + e[6] * cy + e[10] * cz + e[14]
  return centre
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
  if (error === 0) return 0
  if (error == null || error === Infinity) return Infinity
  if (!sphere) return Infinity
  const c = referenceProjectCentre(sphere, offset, e)
  return clusterErrorPixels(error, stretch, c[0], c[1], c[2], sphere[offset + 3], focal, near)
}

/** `errorFloorPixels` from before batch 4c, on the depth that defect-3's corrected bound
 *  uses (`−view(C).z`) where the old one took the distance to the eye: the floor stays the
 *  lower bound of a subtree; the proof is at the `errorFloorAt` site. */
export function referenceErrorFloorPixels(
  error: number | null | undefined,
  stretch: number,
  c: ArrayLike<number>,
  radius: number,
  focal: number,
) {
  if (error === 0) return 0
  if (error == null) return 0
  if (error === Infinity) return Infinity
  if (!(error > 0) || !(radius >= 0)) return 0
  const far = -c[2] + radius * stretch
  if (!(far > 0)) return Infinity
  return (error * stretch * focal) / far
}
