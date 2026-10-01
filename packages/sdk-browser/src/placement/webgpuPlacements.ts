import { moveRootRows } from '../webgpu/pages/render/movedRoot.ts';
import {
  declareOwnMove,
  forgetOwnMoves,
  noteOwnMove,
  ownsMove,
} from '../webgpu/pages/render/movedClusters.ts';
import { staleTemporalBox } from '../hiz/staleRegions.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { followPlacementRows, MOVE_NONE } from './update.ts';
import { placedBy, placementWorld, type PlacementOf, type PlacementRows } from './rows.ts';

type Flipped = { parked?: boolean; mark?: number; placement?: PlacementOf };

/** Hands a root that was parked or taken, or began or stopped casting, to the GPU cut, with the
 *  world-roots object its row places while the row is taken, which the world DAG's residency
 *  mirrors (#1333): a host that hides the mesh hides it, its super-root does not stand in. */
export const flipWorld = (rt: WebgpuPagesRuntime) => (rank: number, root: Flipped) => {
  const cut = rt.run.gpuSelection,
    at = root.placement;
  cut?.parkWorld(rank, !!root.parked);
  cut?.markWorld(rank, root.mark ?? 0);
  const origins = at?.rows.live[at.index] ? at.rows.origins : undefined;
  cut?.placeWorld?.(
    rank,
    origins && at ? origins[at.index] : -1,
    at && placementWorld(at.rows, at.index).elements,
  );
};

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
export function updateWebgpuPlacements(
  rt: WebgpuPagesRuntime,
  rows: PlacementRows,
  from: number,
  to: number,
) {
  const { run, layout, lights } = rt,
    { mobility } = lights;
  // Each moved root stales its own pages, its moving casters only once it was moving already
  // (`../webgpu/shadow/mobility.ts`): the plan keeps the boxes apart (`changes.ts`). A root that
  // only moved declares its clusters at its last pose and its new one (`movedClusters.ts`); the
  // Hi-Z takes its box where it was and is.
  const moved = followPlacementRows(
    layout.selectionRoots,
    rows,
    from,
    to,
    flipWorld(rt),
    (rank, world, forced) => {
      // Weighed once: a pose that moved is noted at its last pose, then taken as a move.
      if (!forced && mobility.poseOf(rank)) {
        if (mobility.holds(rank, world, layout.selectionRoots[rank]?.localBox)) return MOVE_NONE;
        noteOwnMove(rt, rank);
        forced = true;
      }
      return mobility.move(rank, world, forced);
    },
    (rank) => moveRootRows(rt, layout.selectionRoots[rank]),
    (min, max, movingOnly, rank, moveOnly) => {
      if (moveOnly && ownsMove(rank)) declareOwnMove(rt, rank, !movingOnly);
      else lights.plan.worldChanged(min, max, movingOnly);
      staleTemporalBox(run.temporalHizState, min, max);
    },
  );
  forgetOwnMoves();
  // Blend items posed by these rows read them in place: the frame only has to be drawn again,
  // and their boxes follow at its world refresh (`refreshBlendWorlds`).
  if (!moved && !placedBy(rt.blendState.blendGpu, rows)) return;
  // Poses moved and rows were parked or taken: no node entered or left the source graph, so
  // the watched set stands (`frame/gateCore.ts`), and the host index already holds its worlds.
  run.gate.engineMovedInPlace();
}
