import { sortPages } from '../../../../sdk-core/src/index.ts'
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts'
import { ROW_ID_BASE_WORD, packedRowBase, restampHizSlot } from './pageRow.ts'
import type { createPageRowWriter } from './pageRowWriter.ts'
import type { createWebgpuRowState } from './state.ts'
import { createPageCatalogue, type PageList } from '../pages/prepare/catalogue.ts'

type Rows = ReturnType<typeof createWebgpuRowState>
type Writer = ReturnType<typeof createPageRowWriter>

/**
 * The only two ways a row-table rank changes occupant: a page is posted there, or a whole row is
 * moved there. Both keep the parallel arrays that say who occupies what up to date, and raise
 * `state.changed` so the image knows it must send the table again.
 */
export function createWebgpuRowWriters(rows: Rows, packedPages: PageList, writePageRow: Writer) {
  const rowWords = PAGE_INFO_STRIDE / 4
  const state = { changed: false }
  /** A packed rank back to its record: the one catalogue accessor (`../pages/prepare/catalogue.ts`). */
  const { recordOf } = createPageCatalogue(packedPages)

  /** Posts page `page` at rank `row`: the row is written, therefore declared dirty, by the writer. */
  const assign = (row: number, page: number, offsetWords: number) => {
    const rec = recordOf(page)!
    rows.packedRecs[row] = rec
    rows.packedPageIndex[row] = page
    rows.rowPageIndex[row] = page
    rows.rowOffsetWords[row] = offsetWords
    rows.rowEpoch[row] = rows.tableEpoch
    rows.rowOfPage[page] = row
    state.changed = true
    writePageRow(rec, page, row, offsetWords, rows.pageTableFloats!, rows.pageTableInts!)
  }

  /** Moves row `from` to rank `to`: the row's words, then the two that ARE the rank. */
  const moveRow = (from: number, to: number) => {
    const ints = rows.pageTableInts!,
      page = rows.packedPageIndex[from],
      base = to * rowWords
    rows.pageTableFloats!.copyWithin(base, from * rowWords, (from + 1) * rowWords)
    ints[base + ROW_ID_BASE_WORD] = packedRowBase(to)
    restampHizSlot(ints, base, to)
    rows.packedRecs[to] = rows.packedRecs[from]
    rows.packedPageIndex[to] = page
    rows.rowPageIndex[to] = page
    rows.rowOffsetWords[to] = rows.rowOffsetWords[from]
    rows.rowEpoch[to] = rows.rowEpoch[from]
    rows.rowOfPage[page] = to
    rows.markRowDirty(to)
    state.changed = true
  }

  return { assign, moveRow, state }
}

/**
 * The end of a table of `count` rows fills the ranks `free` names, holes walked from lowest to
 * highest and sources from highest to lowest, skipping ranks that are themselves free: each
 * surviving row is moved once, by `move`. Returns the rows kept; `free` is emptied.
 */
export function closeHoles(
  free: { rows: Int32Array; count: number },
  count: number,
  move: (from: number, to: number) => void,
) {
  if (!free.count) return count
  sortPages(free.rows, free.count)
  const kept = count - free.count
  let source = count - 1,
    high = free.count - 1
  for (let i = 0; i < free.count; i++) {
    const hole = free.rows[i]
    if (hole >= kept) break
    while (high >= 0 && free.rows[high] === source) {
      source--
      high--
    }
    move(source--, hole)
  }
  free.count = 0
  return kept
}
