import type * as THREE from 'three';
import { projectBoxesFlat, splitOccludersFlat } from './hiz.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const viewportScratch: [number, number] = [1, 1];

/** Reuses the previous occluder half or splits projected bounds when history cannot partition.
 *  Writes the partition and projection timings into `rt.timing`. */
export function partitionWebgpuVisibility(rt: WebgpuPagesRuntime, camera: THREE.PerspectiveCamera) {
  const { layout, run, vis, timing } = rt,
    { rows, boxCorners, hizBounds, hizProjection, hizRest } = layout,
    { drawnOccluderUrls, urlIndexOfPage } = layout;
  const hasHiz = !!vis.gpuHiz,
    hasRestPipeline = !!vis.visHizRestBack;
  viewportScratch[0] = rt.gpu.targetSize[0];
  viewportScratch[1] = rt.gpu.targetSize[1];
  let occluders = 0,
    twoPass = false,
    boundsForAll = false;
  const worldBoxes = {
    corners: boxCorners,
    pageIndex: rows.packedPageIndex,
    epoch: rows.tableEpoch,
  };
  // Only the rectangles the view or the row table moved under are reprojected; the rest stand.
  hizProjection.reframe(camera, viewportScratch[0], viewportScratch[1], rows.tableEpoch);
  const project = (only: Uint8Array | undefined) => {
    if (hizProjection.select(rows.packedCount, only, rows.packedPageIndex))
      projectBoxesFlat(
        rows.packedRecs,
        rows.packedCount,
        camera,
        viewportScratch,
        hizBounds,
        hizProjection.pending,
        worldBoxes,
      );
    hizProjection.keep(rows.packedCount, rows.packedPageIndex);
  };
  const partitionStart = performance.now();
  hizRest.fill(0, 0, rows.packedCount);
  if (hasHiz && rows.packedCount >= 2) {
    if (!run.noOccluderHistory)
      for (let i = 0; i < rows.packedCount; i++) {
        const rest = drawnOccluderUrls[urlIndexOfPage[rows.packedPageIndex[i]]] ? 0 : 1;
        hizRest[i] = rest;
        if (!rest) occluders++;
      }
    // Without history, or when history keeps or rejects every page, split on projected bounds.
    if (run.noOccluderHistory || !occluders || occluders === rows.packedCount) {
      project(undefined);
      occluders = splitOccludersFlat(rows.packedCount, hizBounds, hizRest);
      boundsForAll = true;
    }
    twoPass = occluders > 0 && occluders < rows.packedCount && hasRestPipeline;
  }
  if (!twoPass) {
    hizRest.fill(0, 0, rows.packedCount);
    occluders = rows.packedCount;
  }
  timing.lastPartitionMs = performance.now() - partitionStart;
  // Only the tested half needs a screen rectangle, and the history branch has projected nothing yet.
  const projectStart = performance.now();
  if (twoPass && !boundsForAll) project(hizRest);
  timing.lastProjectMs = performance.now() - projectStart;
  return { occluders, twoPass };
}
