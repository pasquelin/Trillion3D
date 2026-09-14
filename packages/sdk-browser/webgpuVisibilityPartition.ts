import type * as THREE from 'three';
import { projectBoxesFlat, splitOccludersFlat } from './hiz.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const viewportScratch: [number, number] = [1, 1];

/** Reuses the previous occluder half or splits projected bounds when history cannot partition.
 *  Writes the partition and projection timings into `rt.timing`. */
export function partitionWebgpuVisibility(rt: WebgpuPagesRuntime, camera: THREE.PerspectiveCamera) {
  const { layout, run, vis, timing } = rt,
    { rows, boxCorners, hizBounds, hizRest, drawnOccluderUrls, urlIndexOfPage } = layout;
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
      projectBoxesFlat(
        rows.packedRecs,
        rows.packedCount,
        camera,
        viewportScratch,
        hizBounds,
        undefined,
        worldBoxes,
      );
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
  if (twoPass && !boundsForAll)
    projectBoxesFlat(
      rows.packedRecs,
      rows.packedCount,
      camera,
      viewportScratch,
      hizBounds,
      hizRest,
      worldBoxes,
    );
  timing.lastProjectMs = performance.now() - projectStart;
  return { occluders, twoPass };
}
