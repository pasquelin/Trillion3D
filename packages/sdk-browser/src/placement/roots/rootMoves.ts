/**
 * THE ROOTS A WORLD SEND MOVED, AS EACH PASS THAT DERIVES FROM THEM TAKES THEM (`rootWorlds.ts`):
 * the root boxes pass (`rootBoxes.ts`) holds its own list, the engine's one changed list (`createChangedRuns`: a root named twice is listed once), filled by
 * every send and taken when the pass runs (`takeMoved`) — every root after a whole send, or a cut
 * adopted (`deriveEveryRoot`).
 */
import { createChangedRuns } from '../../geometry/residency/ranges.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

/** The roots a send moved that a pass has not derived yet: every root when `whole`. */
export const movedList = () => ({ whole: true, ranks: createChangedRuns() })
export type MovedList = ReturnType<typeof movedList>

/** `ranks` noted in `list`, unless it already names every root. */
export function noteMoved(list: MovedList, ranks: ArrayLike<number>, count = ranks.length) {
  if (list.whole) return
  for (let k = 0; k < count; k++) list.ranks.mark(ranks[k])
}

/** Root `rank` noted in `list`, unless it already names every root. */
export function noteMovedRank(list: MovedList, rank: number) {
  if (!list.whole) list.ranks.mark(rank)
}

/** Whether `list` names no root. */
export const isEmpty = (list: MovedList) => !list.whole && !list.ranks.count

/** What `list` names, taken: the roots it names, increasing, each once — a view its next take
 *  overwrites, read by the pass at once —, or every root (`undefined`). */
export function takeMoved(list: MovedList) {
  if (!list.whole) return list.ranks.take()
  list.whole = false
  list.ranks.clear()
  return undefined
}

/** A cut adopted: every root's world box and stretch derived again, into its frame words. */
export function deriveEveryRoot(rt: Pick<WebgpuPagesRuntime, 'rootWorlds'>) {
  if (rt.rootWorlds) rt.rootWorlds.roots.whole = true
}
