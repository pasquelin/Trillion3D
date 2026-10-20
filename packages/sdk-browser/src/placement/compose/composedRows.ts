/**
 * THE ROWS OF THE COMPOSED ROOTS WHOSE WORLD MOVED, listed for the rows pass (`../rows/rowWords.ts`): a
 * parent that moves moves every row of its roots, and the pass derives them again from the worlds
 * the compose worlds pass wrote, a thread a row of a root it composed anew (`ComposeState.owed`),
 * never a thread a row of every composed root nor of the table: a parent's move costs the rows of
 * the roots it moves alone. A row written since is the table's dirty row, derived by the CPU's list.
 */
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { ownPageRow } from '../../geometry/rows/state.ts'

/** Whether `row` is a caster row the table holds: a drawn row, or a blended caster's — the one
 *  guard of a row a root's walk (`rootRows`) names. */
const casterRow = (rows: WebgpuPagesRuntime['layout']['rows'], row: number) =>
  row < rows.rowCount || (row >= rows.blendFirst && row < rows.casterSlots)

/** The rows a call lists, held from call to call. */
let listed = new Uint32Array(64)

/** The rows of the roots `ranks` (`rootRows`): a view the next call overwrites. */
export function rowsOfRoots(rt: WebgpuPagesRuntime, ranks: ArrayLike<number>) {
  let count = 0
  const push = (row: number) => {
    if (count === listed.length) listed = resized(listed, count + 1)
    listed[count++] = row
  }
  for (let k = 0; k < ranks.length; k++) rootRows(rt, ranks[k], push)
  return listed.subarray(0, count)
}

/**
 * THE ROWS OF ROOT `rank`'S RESIDENT PAGES, each handed to `visit`: a page's caster row — a blended
 * cluster's own (`../../geometry/rows/blendCasters.ts`) —, never past the caster slots, and an opaque row
 * only while it is still this page's: a row the cache gave back may name another page since.
 */
export function rootRows(rt: WebgpuPagesRuntime, rank: number, visit: (row: number) => void) {
  const { rows, selectionRoots } = rt.layout,
    root = selectionRoots[rank],
    base = root?.packedBase ?? -1
  if (!root || base < 0) return
  for (let page = 0; page < root.pages.length; page++) {
    const row = ownPageRow(rows, base + page, !!root.pages[page].transparent)
    if (row >= 0 && casterRow(rows, row)) visit(row)
  }
}
