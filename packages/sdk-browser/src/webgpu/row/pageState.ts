import { createSparseInts } from '../../page/cut/sparseInts.ts'
import type { PageRec } from '../../page/selection/types.ts'
import { pageAddress } from './pageSlots.ts'
import type { PageResidency, ResidencyChanges } from '../../gpu/core/selection.ts'
import { createRowMapJournal } from './rowMapGpu.ts'

/**
 * WHAT THE ROW CACHE KNOWS OF EACH PACKED PAGE, held for the pages that carry something alone: the
 * visibility row a page draws from, the casters' row a blended one casts from, the residency flag
 * the cut reads — each a sparse map (`../../page/cut/sparseInts.ts`), so its size follows the rows
 * and the resident instances, never the placements a scene repeats its pages on. The pool slot
 * each ADDRESS holds, which every instance of it reads, is the cache's own (`slotWords`): read where
 * it is true, never mirrored. An absent page holds no row and no flag. The page→row map names its
 * writes to a journal, which the GPU's copy of it follows (`rowMapGpu.ts`): the same table.
 */
export function createRowPageState(
  recordOf: (page: number) => PageRec | undefined,
  pageCount: () => number,
  /** The pool slot, in words, `address` holds in the page cache, -1 none: the cache's truth. */
  slotWords: (address: string) => number,
) {
  // A row is stored plus one: an absent page reads -1.
  const rowJournal = createRowMapJournal()
  const rows = createSparseInts(rowJournal),
    blend = createSparseInts(),
    flags = createSparseInts()
  const page = {
    /** The visibility row `page` draws from, -1 none. */
    rowOf: (at: number) => rows.get(at) - 1,
    setRowOf: (at: number, row: number) => void rows.set(at, row + 1),
    /** No page holds a visibility row any more: the table is rebuilt (`rowPasses.ts`). */
    clearRows() {
      rows.clear()
    },
    /** The page→row map's tables and what they wrote since the GPU's copy was sent. */
    rowMap: { tables: rows, journal: rowJournal },
    /** The casters' row the blended `page` casts from, -1 none (`blendCasters.ts`). */
    blendRowOf: (at: number) => blend.get(at) - 1,
    setBlendRowOf: (at: number, row: number) => void blend.set(at, row + 1),
    clearBlendRows: () => blend.clear(),
    /** `page`'s residency flag, as the cut reads it. */
    residentFlag: (at: number) => flags.get(at),
    setResidentFlag: (at: number, value: number) => void flags.set(at, value),
    /** Whether the cut reads `page` resident: a row of its own, and its flag up. */
    readsResident: (at: number) => rows.get(at) > 0 && flags.get(at) > 0,
    /** Whether `page` holds a visibility row. */
    hasRow: (at: number) => rows.get(at) > 0,
    /** The pool slot `page`'s address holds, -1 none: one slot serves every instance of it. */
    offsetOf(at: number) {
      const rec = recordOf(at)
      return rec ? slotWords(pageAddress(rec)) : -1
    },
    /** The pages whose flag is up, as the changes a cut with nothing resident reads to reach the
     *  pool's state: the resident instances, never the catalogue. */
    residentPages(): ResidencyChanges {
      const pages = new Int32Array(flags.size)
      let count = 0
      flags.forEach((key) => void (pages[count++] = key))
      return { pages, count }
    },
    /** The flags as the cut reads them. */
    residency: {
      get length() {
        return pageCount()
      },
      flag: (at: number) => flags.get(at),
    } satisfies PageResidency,
    /** Bytes of the three maps: what the rows and the resident instances hold, never the pages. */
    get pageStateBytes() {
      return rows.byteLength + blend.byteLength + flags.byteLength
    },
  }
  return page
}
