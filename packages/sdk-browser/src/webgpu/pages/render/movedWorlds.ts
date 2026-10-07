/**
 * THE PLACEMENTS WHOSE WORLD A CALL WROTE SINCE THE LAST UPLOAD.
 *
 * Every path that moves a root's world rewrites its rows (`movedRoot.ts`, `moveRootRows`), and
 * names it there, beside that write: its rank is listed once, and the GPU cut's placement tree fits
 * its group again (`placementMoved`). The next image sends those worlds alone
 * (`worldUpload.ts`); a host walk, which names none, sends every one.
 */
import type { GpuSelection } from '../../../gpu/core/selection.ts'
import { grown } from '../../../page/cut/sparseInts.ts'

export type MovedWorlds = { ranks: Int32Array; count: number; listed: Uint8Array }

export const createMovedWorlds = (): MovedWorlds => ({
  ranks: new Int32Array(8),
  count: 0,
  listed: new Uint8Array(8),
})

/** Placement `rank`'s world was just written: listed once, and its tree group told. */
export function noteWorldMoved(
  run: { movedWorlds: MovedWorlds; gpuSelection?: Pick<GpuSelection, 'placementMoved'> },
  rank: number,
) {
  run.gpuSelection?.placementMoved?.(rank)
  const moved = run.movedWorlds
  if (rank >= moved.listed.length) moved.listed = grown(moved.listed, rank + 1, moved.listed.length)
  if (moved.listed[rank]) return
  moved.listed[rank] = 1
  if (moved.count === moved.ranks.length)
    moved.ranks = grown(moved.ranks, moved.count + 1, moved.count)
  moved.ranks[moved.count++] = rank
}

/** The ranks listed since the last call, increasing, the list emptied: a view the next note
 *  overwrites. */
export function takeMovedWorlds(moved: MovedWorlds) {
  const ranks = moved.ranks.subarray(0, moved.count).sort()
  for (const rank of ranks) moved.listed[rank] = 0
  moved.count = 0
  return ranks
}
