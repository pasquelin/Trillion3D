// Comparison of the audit to the REFERENCE, cluster by cluster.
//
// The reference is not transcribed: it is the production code itself, `projectCornersInto`
// (hizCorners.ts) followed by `hizNearestBound` (hizNearestBound.ts) — the double-precision
// arithmetic the CPU did per row before the partition moved to the GPU, and that the CPU cut
// and the oracles still do. The page module is bundled from the repository sources, so the
// proof reads exactly what the engine reads.
//
// What the comparison checks:
//   1. the GPU rectangle CONTAINS that of the reference (each bound is at least as
//      wide, never narrower by one texel);
//   2. a box the reference says is clipped by the near plane carries the clip flag on the
//      GPU side, so it can never be rejected;
//   3. the GPU depth UNDERESTIMATES that of the reference, coplanar-layer bias included.
import { HIZ_BOUNDS_VALUES, projectCornersInto } from '../../packages/sdk-browser/hizCorners.ts';
import { hizNearestBound } from '../../packages/sdk-browser/hizNearestBound.ts';
import type { PartitionAudit } from '../../packages/sdk-browser/webgpuPartitionAudit.ts';

const scratch = new Float64Array(HIZ_BOUNDS_VALUES);

/** Compares the audit of a frame to the reference, row by row, and accumulates into `total`. */
export function compareAudit(audit: PartitionAudit, total: ReturnType<typeof emptyTotals>) {
  const { rows, view, viewProj, near, width, height, corners, layers } = audit;
  for (let row = 0; row < rows; row++) {
    // One depth convention (`depthConvention.ts`): the reference reads the same
    // view-projection as the kernel, and its bound compares directly to the one it wrote.
    projectCornersInto(corners, row * 24, view, viewProj, near, width, height, scratch, 0);
    total.clusters++;
    if (scratch[5] !== 0) {
      total.coupes++;
      // Rule 2: a box the reference says is clipped must carry the flag on the GPU side.
      if (!audit.clips[row]) total.violations2++;
      continue;
    }
    // A box the GPU says is clipped while the reference does not is never rejected:
    // that is more conservative, never less. It is counted, not compared.
    if (audit.clips[row]) {
      total.coupesGpuSeules++;
      continue;
    }
    total.compares++;
    const rx0 = scratch[0],
      ry0 = scratch[1],
      rx1 = scratch[2],
      ry1 = scratch[3];
    const gx0 = audit.rect[row * 4],
      gy0 = audit.rect[row * 4 + 1],
      gx1 = audit.rect[row * 4 + 2],
      gy1 = audit.rect[row * 4 + 3];
    // Rule 1: containment. The margin is what the GPU added on each side, in texels.
    for (const marge of [rx0 - gx0, ry0 - gy0, gx1 - rx1, gy1 - ry1]) {
      if (marge < 0) total.violations1++;
      total.margeTexelsSomme += marge;
      if (marge > total.margeTexelsMax) total.margeTexelsMax = marge;
      total.margeTexelsCount++;
      // The mean of a margin is crushed by a few grazing boxes: what truly describes the
      // loss of test fineness is the distribution — how many sides have not moved by one texel.
      total.margeParPalier[
        marge <= 0 ? 0 : marge <= 1 ? 1 : marge <= 4 ? 2 : marge <= 16 ? 3 : 4
      ]++;
    }
    // Rectangle width, compared to the test's sixteen-texel kernel: beyond, the box answers
    // from a coarser mip and rejects less. The two distributions must look alike.
    const palier = (w: number) => (w < 16 ? 0 : w < 64 ? 1 : w < 256 ? 2 : 3);
    total.largeurParPalier[palier(Math.max(gx1 - gx0, gy1 - gy0))]++;
    total.largeurRefParPalier[palier(Math.max(rx1 - rx0, ry1 - ry0))]++;
    // Rule 3: overestimate. Depth is reversed, so a safe bound OVERESTIMATES what the
    // cluster will write: the delta is what the GPU raised above the reference.
    const ecart = audit.nearest[row] - hizNearestBound(scratch[4], layers[row]);
    if (ecart < 0) total.violations3++;
    total.ecartProfondeurSomme += ecart;
    if (ecart > total.ecartProfondeurMax) total.ecartProfondeurMax = ecart;
  }
}

export function emptyTotals() {
  return {
    clusters: 0,
    compares: 0,
    coupes: 0,
    coupesGpuSeules: 0,
    violations1: 0,
    violations2: 0,
    violations3: 0,
    margeTexelsSomme: 0,
    margeTexelsMax: 0,
    margeTexelsCount: 0,
    /** Rectangle sides by margin bucket: 0, ≤ 1, ≤ 4, ≤ 16, beyond. */
    margeParPalier: [0, 0, 0, 0, 0],
    /** Boxes by screen-width bucket, GPU then reference: < 16, < 64, < 256, beyond. */
    largeurParPalier: [0, 0, 0, 0],
    largeurRefParPalier: [0, 0, 0, 0],
    ecartProfondeurSomme: 0,
    ecartProfondeurMax: 0,
  };
}
