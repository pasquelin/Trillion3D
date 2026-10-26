import { createSparseInts } from '../cut/sparseInts.ts'
import type { PageRec } from '../selection/types.ts'
import { pageAddress } from '../rows/page/pageSlots.ts'
import type { PageResidency, ResidencyChanges } from '../../gpu/core/selection.ts'

/**
 * WHAT THE CLUSTER RESIDENCY KNOWS OF EACH PACKED PAGE, held for the pages that carry something
 * alone: the residency flag the cut reads, a sparse map (`../cut/sparseInts.ts`), so its size
 * follows the resident instances, never the placements a scene repeats its pages on. The pool slot
 * each ADDRESS holds, which every instance of it reads, is the cache's own (`slotWords`): read
 * where it is true, never mirrored. An absent page holds no flag.
 */
export function createClusterPageState(
  recordOf: (page: number) => PageRec | undefined,
  pageCount: () => number,
  /** The pool slot, in words, `address` holds in the page cache, -1 none: the cache's truth. */
  slotWords: (address: string) => number,
) {
  const flags = createSparseInts()
  return {
    /** `page`'s residency flag, as the cut reads it. */
    residentFlag: (at: number) => flags.get(at),
    setResidentFlag: (at: number, value: number) => void flags.set(at, value),
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
    /** Bytes of the flags: what the resident instances hold, never the pages. */
    get pageStateBytes() {
      return flags.byteLength
    },
  }
}
