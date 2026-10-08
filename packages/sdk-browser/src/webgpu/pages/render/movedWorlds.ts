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
import { createDenseKeySet, type DenseKeySet } from '../../cut/denseKeys.ts'

/** The ranks listed since the last take, each once, and the increasing view a take hands out. */
export type MovedWorlds = { listed: DenseKeySet; sorted: Int32Array }

export const createMovedWorlds = (): MovedWorlds => ({
  listed: createDenseKeySet(),
  sorted: new Int32Array(8),
})

/** Placement `rank`'s world was just written: listed once, and its tree group told. */
export function noteWorldMoved(
  run: { movedWorlds: MovedWorlds; gpuSelection?: Pick<GpuSelection, 'placementMoved'> },
  rank: number,
) {
  run.gpuSelection?.placementMoved?.(rank)
  run.movedWorlds.listed.add(rank)
}

/** The ranks listed since the last call, increasing, the list emptied: a view the next take
 *  overwrites. */
export function takeMovedWorlds(moved: MovedWorlds) {
  const { list, count } = moved.listed
  if (moved.sorted.length < count) moved.sorted = grown(moved.sorted, count)
  const ranks = moved.sorted.subarray(0, count)
  ranks.set(list.subarray(0, count))
  ranks.sort()
  moved.listed.clear()
  return ranks
}
