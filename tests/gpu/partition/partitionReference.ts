// The partition audit held against the reference, row by row. The reference is the engine's own
// double-precision arithmetic — `projectCornersInto` (`hiz/corners.ts`) then `hizNearestBound`
// (`hiz/nearestBound.fixture.ts`), what the CPU did per row before the partition moved to the GPU
// and what the CPU cut and the oracles still do. Three rules:
//   1. the GPU rectangle contains the reference's, each side at least as wide;
//   2. a box the reference says the near plane clips carries the clip flag, so it is never
//      rejected;
//   3. the GPU depth bound stands nearer than the reference's, the coplanar layer's bias included.
import {
  HIZ_BOUNDS_VALUES,
  projectCornersInto,
} from '../../../packages/sdk-browser/src/hiz/corners.ts';
import { hizNearestBound } from '../../../packages/sdk-browser/src/hiz/nearestBound.fixture.ts';
import type { PartitionAudit } from '../../../packages/sdk-browser/src/webgpu/core/partitionAudit.ts';

const scratch = new Float64Array(HIZ_BOUNDS_VALUES);
/** A rectangle side's margin bucket, in texels: 0, ≤ 1, ≤ 4, ≤ 16, beyond. */
const marginBucket = (margin: number) =>
  margin <= 0 ? 0 : margin <= 1 ? 1 : margin <= 4 ? 2 : margin <= 16 ? 3 : 4;
/** A box's width bucket against the test's sixteen-texel kernel: < 16, < 64, < 256, beyond. */
const widthBucket = (width: number) => (width < 16 ? 0 : width < 64 ? 1 : width < 256 ? 2 : 3);

export function emptyTotals() {
  return {
    rows: 0,
    compared: 0,
    clipped: 0,
    /** Boxes the GPU calls clipped and the reference does not: more conservative, never compared. */
    clippedOnGpuOnly: 0,
    containmentViolations: 0,
    clipViolations: 0,
    depthViolations: 0,
    marginSum: 0,
    marginMax: 0,
    marginCount: 0,
    /** Rectangle sides by margin bucket (`marginBucket`). */
    marginBuckets: [0, 0, 0, 0, 0],
    /** Boxes by screen-width bucket (`widthBucket`), the GPU's then the reference's. */
    widthBuckets: [0, 0, 0, 0],
    referenceWidthBuckets: [0, 0, 0, 0],
    depthGapSum: 0,
    depthGapMax: 0,
  };
}
export type PartitionTotals = ReturnType<typeof emptyTotals>;

/** Holds one frame's audit against the reference and adds what it found to `total`. */
export function compareAudit(audit: PartitionAudit, total: PartitionTotals) {
  const { rows, view, viewProj, near, width, height, corners, layers } = audit;
  for (let row = 0; row < rows; row++) {
    // One depth convention (`depthConvention.ts`): the reference reads the kernel's
    // view-projection, and its bound compares directly to the one the kernel wrote.
    projectCornersInto(corners, row * 24, view, viewProj, near, width, height, scratch, 0);
    total.rows++;
    if (scratch[5] !== 0) {
      total.clipped++;
      if (!audit.clips[row]) total.clipViolations++;
      continue;
    }
    if (audit.clips[row]) {
      total.clippedOnGpuOnly++;
      continue;
    }
    total.compared++;
    const [rx0, ry0, rx1, ry1] = scratch;
    const [gx0, gy0, gx1, gy1] = audit.rect.subarray(row * 4, row * 4 + 4);
    // Containment: the margin is what the GPU added on each side, in texels. Its mean drowns in
    // a few grazing boxes: the buckets say how many sides moved by less than a texel.
    for (const margin of [rx0 - gx0, ry0 - gy0, gx1 - rx1, gy1 - ry1]) {
      if (margin < 0) total.containmentViolations++;
      total.marginSum += margin;
      total.marginMax = Math.max(total.marginMax, margin);
      total.marginCount++;
      total.marginBuckets[marginBucket(margin)]++;
    }
    // Past sixteen texels a box answers from a coarser mip and rejects less: both distributions
    // must look alike.
    total.widthBuckets[widthBucket(Math.max(gx1 - gx0, gy1 - gy0))]++;
    total.referenceWidthBuckets[widthBucket(Math.max(rx1 - rx0, ry1 - ry0))]++;
    // Depth is reversed: a safe bound stands above what the cluster writes, and the gap is what
    // the GPU raised it by.
    const gap = audit.nearest[row] - hizNearestBound(scratch[4], layers[row]);
    if (gap < 0) total.depthViolations++;
    total.depthGapSum += gap;
    total.depthGapMax = Math.max(total.depthGapMax, gap);
  }
}
