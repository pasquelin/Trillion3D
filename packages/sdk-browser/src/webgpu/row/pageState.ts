import { createSparseInts } from '../../page/cut/sparseInts.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import { pageAddress } from './pageSlots.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import type { PageResidency } from '../../gpu/core/selection.ts'

/** The bits of a page's `readable` byte (`createRowPageState`). */
const HAS_ROW = 2,
  READ = 1

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
  /** A byte a page up to the largest one that held a row: `HAS_ROW` while it holds one, `READ` too
   *  while the cut reads it resident — its flag up —, what the row demand reads per id at each
   *  readback with no probe (`rowDemand.ts`). */
  let readable = new Uint8Array(0)
  const follow = (at: number) => {
    const row = rows.get(at) > 0
    const value = row ? HAS_ROW | (flags.get(at) > 0 ? READ : 0) : 0
    if (at >= readable.length) {
      if (!value) return
      readable = resized(readable, at + 1)
    }
    readable[at] = value
  }
  const page = {
    /** The visibility row `page` draws from, -1 none. */
    rowOf: (at: number) => rows.get(at) - 1,
    setRowOf(at: number, row: number) {
      rows.set(at, row + 1)
      follow(at)
    },
    /** No page holds a visibility row any more: the table is rebuilt (`slotOps.ts`). */
    clearRows() {
      rows.clear()
      readable.fill(0)
    },
    /** The casters' row the blended `page` casts from, -1 none (`blendCasters.ts`). */
    blendRowOf: (at: number) => blend.get(at) - 1,
    setBlendRowOf: (at: number, row: number) => void blend.set(at, row + 1),
    clearBlendRows: () => blend.clear(),
    /** `page`'s residency flag, as the cut reads it. */
    residentFlag: (at: number) => flags.get(at),
    setResidentFlag(at: number, value: number) {
      flags.set(at, value)
      follow(at)
    },
    /** Whether the cut reads `page` resident: a row of its own, and its flag up. */
    readsResident: (at: number) => ((readable[at] ?? 0) & READ) !== 0,
    /** Whether `page` holds a visibility row, read with no probe. */
    hasRow: (at: number) => ((readable[at] ?? 0) & HAS_ROW) !== 0,
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
    /** The flags as the cut reads them. */
    residency: {
      get length() {
        return pageCount()
      },
      flag: (at: number) => flags.get(at),
    } satisfies PageResidency,
    /** Bytes of the three maps: what the rows and the resident instances hold, never the pages. */
    get pageStateBytes() {
      return rows.byteLength + blend.byteLength + flags.byteLength + readable.byteLength
    },
  }
  return page
}
