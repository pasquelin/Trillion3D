/**
 * THE ROOTS A WORLD SEND MOVED, AS EACH PASS THAT DERIVES FROM THEM TAKES THEM (`rootWorlds.ts`):
 * the rows pass (`rowWords.ts`) and the root boxes pass (`rootBoxes.ts`) each hold their own list,
 * filled by every send and taken when the pass runs (`takeMoved`) — every root after a whole send,
 * or a cut adopted (`deriveEveryRoot`).
 */
import { resized } from '../../../math/src/sequence/resized.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'

/** The roots a send moved that a pass has not derived yet: every root when `whole`. */
export const movedList = () => ({ whole: true, ranks: new Int32Array(8), count: 0 })
type MovedList = ReturnType<typeof movedList>

/** `ranks` noted in `list`, unless it already names every root. */
export function noteMoved(list: MovedList, ranks: ArrayLike<number>, count = ranks.length) {
  if (list.whole) return
  list.ranks = resized(list.ranks, list.count + count)
  for (let k = 0; k < count; k++) list.ranks[list.count++] = ranks[k]
}

/** What `list` names, taken: the roots it names — a view its next `noteMoved` overwrites, read
 *  by the pass at once —, or every root (`undefined`). */
export function takeMoved(list: MovedList) {
  if (list.whole) {
    list.whole = false
    list.count = 0
    return undefined
  }
  const ranks = list.ranks.subarray(0, list.count)
  list.count = 0
  return ranks
}

/** A cut adopted: every root's world box and stretch derived again, into its frame words. */
export function deriveEveryRoot(rt: Pick<WebgpuPagesRuntime, 'rootWorlds'>) {
  if (rt.rootWorlds) rt.rootWorlds.roots.whole = true
}
