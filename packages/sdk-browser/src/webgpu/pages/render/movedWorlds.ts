/**
 * THE PLACEMENTS WHOSE WORLD A CALL WROTE SINCE THE LAST UPLOAD.
 *
 * Every path that moves a root's world rewrites its rows (`movedRoot.ts`, `moveRootRows`), and
 * names it there, beside that write: its rank is listed once, and the GPU cut's placement tree fits
 * its group again (`placementMoved`). The next image sends those worlds alone
 * (`worldUpload.ts`, `takeSorted`); a host walk, which names none, sends every one. While a cut is
 * made beside the running one (`../../../placement/webgpuGrowth.ts`), every move is kept for it as
 * well (`since`): its swap replays them.
 */
import type { GpuSelection } from '../../../gpu/core/selection.ts'
import type { SortedKeys } from '../../cut/denseKeys.ts'

/** The ranks listed since the last take; `since`, while a cut is made beside the running one, the
 *  ranks named since its pack and whether a host walk moved every world. */
export type MovedWorlds = SortedKeys & { since?: { ranks: SortedKeys; walked: boolean } }

/** Placement `rank`'s world was just written: listed once, and its tree group told. */
export function noteWorldMoved(
  run: { movedWorlds: MovedWorlds; gpuSelection?: Pick<GpuSelection, 'placementMoved'> },
  rank: number,
) {
  run.gpuSelection?.placementMoved?.(rank)
  run.movedWorlds.listed.add(rank)
  run.movedWorlds.since?.ranks.listed.add(rank)
}
