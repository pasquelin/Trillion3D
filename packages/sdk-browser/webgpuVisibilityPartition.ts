import type * as THREE from 'three';
import { projectBoxesFlat, splitOccludersFlat, type createBoxCorners } from './hiz.ts';
import type { createWebgpuRowState } from './webgpuRowState.ts';
type Rows = ReturnType<typeof createWebgpuRowState>;
type PartitionOptions = {
  rows: Rows;
  camera: THREE.PerspectiveCamera;
  width: number;
  height: number;
  boxCorners: ReturnType<typeof createBoxCorners>;
  hizBounds: Float64Array;
  hizRest: Uint8Array;
  drawnOccluderUrls: Uint8Array;
  urlIndexOfPage: Int32Array;
  noOccluderHistory: boolean;
  hasHiz: boolean;
  hasRestPipeline: boolean;
};

/** Reuses the previous occluder half or splits projected bounds when history cannot partition. */
export function partitionWebgpuVisibility({
  rows,
  camera,
  width,
  height,
  boxCorners,
  hizBounds,
  hizRest,
  drawnOccluderUrls,
  urlIndexOfPage,
  noOccluderHistory,
  hasHiz,
  hasRestPipeline,
}: PartitionOptions) {
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
    if (!noOccluderHistory)
      for (let i = 0; i < rows.packedCount; i++) {
        const rest = drawnOccluderUrls[urlIndexOfPage[rows.packedPageIndex[i]]] ? 0 : 1;
        hizRest[i] = rest;
        if (!rest) occluders++;
      }
    // Without history, or when history keeps or rejects every page, split on projected bounds.
    if (noOccluderHistory || !occluders || occluders === rows.packedCount) {
      projectBoxesFlat(
        rows.packedRecs,
        rows.packedCount,
        camera,
        [width, height],
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
  const partitionMs = performance.now() - partitionStart;
  // Only the tested half needs a screen rectangle, and the history branch has projected nothing yet.
  const projectStart = performance.now();
  if (twoPass && !boundsForAll)
    projectBoxesFlat(
      rows.packedRecs,
      rows.packedCount,
      camera,
      [width, height],
      hizBounds,
      hizRest,
      worldBoxes,
    );
  const projectMs = performance.now() - projectStart;
  return { occluders, twoPass, partitionMs, projectMs };
}
