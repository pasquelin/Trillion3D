import { moveRootRows } from '../webgpu/pages/render/movedRoot.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { followPlacementRows } from './update.ts';
import { placedBy, type PlacementRows } from './rows.ts';

/**
 * Rows of an instance buffer the WebGPU page raster was opened with were written. The roots read
 * their worlds from the rows, so nothing is copied: their boxes are reprojected, a parked row
 * leaves the GPU cut's first queue and a taken one enters it (`parkWorld`), a row that stops or
 * starts casting leaves or enters every light cut (`markWorld`), the page rows of the
 * roots that read them are rewritten, and them alone (`moveRootRows`), and the frame learns that
 * poses moved — the worlds go up in one write at the next image, and the shadow pages the change
 * touched are drawn again: their moving casters only, once the placements are known to move
 * (`../webgpu/shadow/mobility.ts`). No table is resized and nothing is prepared again.
 */
/** Hands a root that was parked or taken, or began or stopped casting, to the GPU cut. */
export const flipWorld =
  (rt: WebgpuPagesRuntime) => (rank: number, root: { parked?: boolean; mark?: number }) => {
    rt.run.gpuSelection?.parkWorld(rank, !!root.parked);
    rt.run.gpuSelection?.markWorld(rank, root.mark ?? 0);
  };

export function updateWebgpuPlacements(
  rt: WebgpuPagesRuntime,
  rows: PlacementRows,
  from: number,
  to: number,
) {
  const { run, layout, lights } = rt;
  // Each moved root stales its own pages, its moving casters only once it was moving already
  // (`../webgpu/shadow/mobility.ts`): the plan keeps the boxes apart (`changes.ts`).
  const moved = followPlacementRows(
    layout.selectionRoots,
    rows,
    from,
    to,
    flipWorld(rt),
    lights.mobility.move,
    (rank) => moveRootRows(rt, layout.selectionRoots[rank]),
    lights.plan.worldChanged,
  );
  // Blend items posed by these rows read them in place: the frame only has to be drawn again,
  // and their boxes follow at its world refresh (`refreshBlendWorlds`).
  if (!moved && !placedBy(rt.blendState.blendGpu, rows)) return;
  // Poses moved and rows were parked or taken: no node entered or left the source graph, so
  // the watched set stands (`frame/gateCore.ts`), and the host index already holds its worlds.
  run.gate.engineWriting();
  run.gate.sceneMoved();
  run.gate.noteWorldsUpdated();
}
