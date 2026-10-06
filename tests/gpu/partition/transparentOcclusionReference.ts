// The transparent occlusion test's rejects refuted, cluster by cluster, by the engine's own
// reference: `projectCornersInto` (`hiz/corners.ts`) in double precision, `hizNearestBound` for
// the lift and the layer's bias, then `buildHizPyramid` and `hizRejectsFlat` (`hiz/depth.ts`,
// `hiz/occlusion.ts`) on the depth the GPU left after the opaque pass, read back at full
// resolution. Every transparent cluster the GPU removed must be rejected by the reference on its
// own, tighter, bounds: `nearest < far − bias` holds with every GPU margin taken away — its error
// margin, its widened rectangle, its coarser mip.
import {
  BOX_CORNER_VALUES,
  HIZ_BOUNDS_VALUES,
  projectCornersInto,
} from '../../../packages/sdk-browser/src/hiz/corners.ts'
import { hizNearestBound } from '../../../packages/sdk-browser/src/hiz/nearestBound.fixture.ts'
import { buildHizPyramid } from '../../../packages/sdk-browser/src/hiz/depth.ts'
import { hizRejectsFlat } from '../../../packages/sdk-browser/src/hiz/occlusion.ts'
import type { TransparentOcclusionAudit } from '../../../packages/sdk-browser/src/webgpu/transparent/occlusionAudit.ts'

const scratch = new Float64Array(HIZ_BOUNDS_VALUES)

export function emptyOcclusionTotals() {
  return { rejected: 0, examined: 0, violations: 0, clippedByReference: 0, offScreen: 0, poses: 0 }
}
export type OcclusionTotals = ReturnType<typeof emptyOcclusionTotals>

/** Checks one frame's audit, adds what it found to `total`, and returns its first violations.
 *  The reference pyramid is built once per pose, from the depth read back. */
export function checkOcclusionAudit(audit: TransparentOcclusionAudit, total: OcclusionTotals) {
  // One depth convention (`depthConvention.ts`): reference and kernel read the same
  // view-projection, so their bounds compare directly.
  const pyramid = buildHizPyramid(audit.depth, audit.width, audit.height)
  total.poses++
  total.examined += audit.examined
  const violations = []
  for (const [i, entry] of audit.rejected.entries()) {
    total.rejected++
    projectCornersInto(
      audit.corners,
      i * BOX_CORNER_VALUES,
      audit.view,
      audit.viewProj,
      audit.near,
      audit.width,
      audit.height,
      scratch,
      0,
    )
    // A box the reference says the near plane clips must never have been rejected.
    if (scratch[5] !== 0) {
      total.clippedByReference++
      total.violations++
      if (violations.length < 5) violations.push({ entry, cause: 'clipped by the near plane' })
      continue
    }
    // The reference rectangle holds the cluster's whole footprint: if it misses the viewport, the
    // cluster covers no pixel and removing it changes nothing — and the reference never rejects
    // an off-screen box, so there is nothing to compare.
    if (
      Math.max(scratch[0], 0) > Math.min(scratch[2], audit.width - 1) ||
      Math.max(scratch[1], 0) > Math.min(scratch[3], audit.height - 1)
    ) {
      total.offScreen++
      continue
    }
    scratch[4] = hizNearestBound(scratch[4], audit.layer)
    if (!hizRejectsFlat(pyramid, scratch, 0)) {
      total.violations++
      if (violations.length < 5)
        violations.push({
          entry,
          cause: 'visible to the reference',
          nearest: scratch[4],
          rect: [scratch[0], scratch[1], scratch[2], scratch[3]],
        })
    }
  }
  return violations
}
