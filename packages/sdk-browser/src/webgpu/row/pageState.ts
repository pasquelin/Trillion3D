import { createSparseInts } from '../../page/cut/sparseInts.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import { pageAddress } from './pageSlots.ts'
import type { PageResidency, ResidencyChanges } from '../../gpu/core/selection.ts'

/**
 * WHAT THE ROW CACHE KNOWS OF EACH PACKED PAGE, held for the pages that carry something alone: the
 * visibility row a page draws from, the casters' row a blended one casts from, the residency flag
 * the cut reads — each a sparse map (`../../page/cut/sparseInts.ts`), so its size follows the rows
 * and the resident instances, never the placements a scene repeats its pages on —, and the pool slot
 * each ADDRESS holds, one per resident address, which every instance of it reads. An absent page
 * holds no row and no flag; an absent address no slot.
 */
export function createRowPageState(
  recordOf: (page: number) => PageRec | undefined,
  pageCount: () => number,
) {
  // A row and a slot are stored plus one: an absent page reads -1.
  const rows = createSparseInts(),
    blend = createSparseInts(),
    flags = createSparseInts(),
    offsets = new Map<string, number>()
  const page = {
    /** The visibility row `page` draws from, -1 none. */
    rowOf: (at: number) => rows.get(at) - 1,
    setRowOf: (at: number, row: number) => void rows.set(at, row + 1),
    /** No page holds a visibility row any more: the table is rebuilt (`slotOps.ts`). */
    clearRows() {
      rows.clear()
    },
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
    /** The pool slot, in words, `address` holds, -1 none (`../residency/mirror.ts`). */
    addressOffset: (address: string) => offsets.get(address) ?? -1,
    setAddressOffset(address: string, words: number) {
      if (words < 0) offsets.delete(address)
      else offsets.set(address, words)
    },
    /** Every address leaves the pool's mirror, before it is read again whole. */
    clearAddressOffsets: () => offsets.clear(),
    /** The pool slot `page`'s address holds, -1 none: one slot serves every instance of it. */
    offsetOf(at: number) {
      const rec = recordOf(at)
      return rec ? (offsets.get(pageAddress(rec)) ?? -1) : -1
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
