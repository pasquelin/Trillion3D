// Refutation, cluster by cluster, of the transparent occlusion test's rejects.
//
// The reference is not transcribed: it is production code itself — `projectCornersInto`
// (hizCorners.ts) in double precision, `hizNearestBound` (hizNearestBound.ts) for the lift and
// layer bias, `buildHizPyramid` then `hizRejectsFlat` (hizDepth.ts, hizOcclusion.ts) for the
// readout. The readout depth is what the GPU actually left at the end of the opaque pass,
// reread at full resolution.
//
// What is checked, for EVERY transparent cluster the GPU removed: the reference, on its own
// bounds — tighter than the GPU's — rejects it too. In other words `nearest < far − bias` still
// holds when everything is refused to the GPU: its error margin, its enlarged rectangle and its
// coarser mip. Zero violations is the only acceptable value.
import { HIZ_BOUNDS_VALUES, projectCornersInto } from '../../../packages/sdk-browser/hizCorners.ts';
import { hizNearestBound } from '../../../packages/sdk-browser/hizNearestBound.ts';
import { buildHizPyramid } from '../../../packages/sdk-browser/hizDepth.ts';
import { hizRejectsFlat } from '../../../packages/sdk-browser/hizOcclusion.ts';
import type { TransparentOcclusionAudit } from '../../../packages/sdk-browser/webgpuTransparentOcclusionAudit.ts';

const scratch = new Float64Array(HIZ_BOUNDS_VALUES);
/** Doubles of a world box in the `createBoxCorners` layout. */
const BOX_CORNER_VALUES = 24;

export function emptyOcclusionTotals() {
  return { rejetees: 0, examinees: 0, violations: 0, coupesReference: 0, horsEcran: 0, poses: 0 };
}

/**
 * Checks a frame's audit and accumulates into `total`. The reference pyramid is built once per
 * pose, from the reread depth, and serves every cluster of that pose.
 */
export function checkOcclusionAudit(
  audit: TransparentOcclusionAudit,
  total: ReturnType<typeof emptyOcclusionTotals>,
) {
  // One depth convention crosses the engine (`depthConvention.ts`): reference and kernel read
  // the same view-projection, so their bounds compare directly.
  const pyramid = buildHizPyramid(audit.depth, audit.width, audit.height);
  total.poses++;
  total.examinees += audit.examined;
  const violations = [];
  for (let i = 0; i < audit.rejected.length; i++) {
    total.rejetees++;
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
    );
    // A box the reference says is clipped by the near plane must never have been rejected.
    if (scratch[5] !== 0) {
      total.coupesReference++;
      total.violations++;
      if (violations.length < 5) violations.push({ entree: audit.rejected[i], cause: 'coupe' });
      continue;
    }
    // The REFERENCE rectangle already contains the cluster's true footprint: if it does not
    // meet the viewport, the cluster can pose no pixel and removing it has no effect on the
    // image. The reference, for its part, refuses to decide in that case — it never rejects an
    // off-screen box — so the comparison has no place.
    if (
      Math.max(scratch[0], 0) > Math.min(scratch[2], audit.width - 1) ||
      Math.max(scratch[1], 0) > Math.min(scratch[3], audit.height - 1)
    ) {
      total.horsEcran++;
      continue;
    }
    scratch[4] = hizNearestBound(scratch[4], audit.layer);
    if (!hizRejectsFlat(pyramid, scratch, 0)) {
      total.violations++;
      if (violations.length < 5)
        violations.push({
          entree: audit.rejected[i],
          cause: 'visible to the reference',
          nearest: scratch[4],
          rect: [scratch[0], scratch[1], scratch[2], scratch[3]],
        });
    }
  }
  return violations;
}
