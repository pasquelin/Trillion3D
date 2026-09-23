import { invalidateOccluderHistory } from '../webgpu/pages/io/drops.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { followPlacementRows } from './placementUpdate.ts';
import { placedBy, type PlacementRows } from './placementRows.ts';

/**
 * Rows of an instance buffer the WebGPU page raster was opened with were written. The roots read
 * their worlds from the rows, so nothing is copied: their boxes are reprojected, a parked row
 * leaves the GPU cut's first queue and a taken one enters it (`parkWorld`), and the frame learns
 * that poses moved — the worlds go up in one write at the next image, the rows are rewritten
 * under a new table epoch, the occluder history no longer holds, and the shadow slices the
 * change touched are drawn again. No table is resized and nothing is prepared again.
 */
export function updateWebgpuPlacements(
  rt: WebgpuPagesRuntime,
  rows: PlacementRows,
  from: number,
  to: number,
) {
  const { run, layout, lights } = rt;
  const touched = followPlacementRows(layout.selectionRoots, rows, from, to, (rank, parked) =>
    run.gpuSelection?.parkWorld(rank, parked),
  );
  // Blend items posed by these rows read them in place: the frame only has to be drawn again,
  // and their boxes follow at its world refresh (`refreshBlendWorlds`).
  if (!touched && !placedBy(rt.blendState.blendGpu, rows)) return;
  // Poses moved and rows were parked or taken: no node entered or left the source graph, so
  // the watched set stands (`frame/gateCore.ts`), and the host index already holds its worlds.
  run.gate.sceneMoved();
  run.gate.noteWorldsUpdated();
  if (!touched) return;
  layout.rows.tableEpoch++;
  invalidateOccluderHistory(run);
  lights.plan.worldChanged(touched.min, touched.max);
}
