/**
 * THE ROOTS A WORLD SEND MOVED, AS EACH PASS THAT DERIVES FROM THEM TAKES THEM (`rootWorlds.ts`):
 * the rows pass (`takeMovedRows`, `rowWords.ts`) and the root boxes pass (`takeMovedRoots`,
 * `rootBoxes.ts`) each hold their own list, filled by every send and taken when the pass runs —
 * every root after a whole send, or a cut adopted (`deriveEveryRoot`).
 */
import { resized } from '../../../math/src/sequence/resized.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'

/** The roots a send moved that a pass has not derived yet: every root when `whole`. */
export const movedList = () => ({ whole: true, ranks: new Int32Array(8), count: 0 })
type MovedList = ReturnType<typeof movedList>
type Lists = { rows: MovedList; roots: MovedList }

/** `ranks` noted in `list`, unless it already names every root. */
export function noteMoved(list: MovedList, ranks: ArrayLike<number>, count = ranks.length) {
  if (list.whole) return
  list.ranks = resized(list.ranks, list.count + count)
  for (let k = 0; k < count; k++) list.ranks[list.count++] = ranks[k]
}

const EMPTY = new Int32Array(0)

/** What `list` names, taken: the roots it names, or every root (`undefined`). */
function take(list: MovedList) {
  if (list.whole) {
    list.whole = false
    list.count = 0
    return undefined
  }
  if (!list.count) return EMPTY
  const ranks = list.ranks.slice(0, list.count)
  list.count = 0
  return ranks
}

/** The roots whose rows the rows pass derives again: those moved since it last took them, or
 *  every root (`undefined`) after a whole send. */
export const takeMovedRows = (held: Lists) => take(held.rows)

/** The roots whose world box and stretch the root boxes pass derives again. */
export const takeMovedRoots = (held: Lists) => take(held.roots)

/** A cut adopted: every root's world box and stretch derived again, into its frame words. */
export function deriveEveryRoot(rt: Pick<WebgpuPagesRuntime, 'rootWorlds'>) {
  if (rt.rootWorlds) rt.rootWorlds.roots.whole = true
}
