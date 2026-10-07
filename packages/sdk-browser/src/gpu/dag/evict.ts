import { pageAddress } from '../../webgpu/row/pageSlots.ts'
import { REQUEST_PRIORITY_MAX } from './request.ts'
import type { DagRoot } from './types.ts'

/**
 * The EVICTION QUEUE the GPU cut publishes on its readback (#872, `shader/evictWgsl.ts`). The cache
 * evicts per content key (`pageAddress`), the GPU stamps per placement: a page's key word names its
 * address's first page — its CANONICAL page, where every placement stamps — in its low
 * `KEY_PAGE_BITS`, and carries the key's coarsest level (#824) in the five above. Finer level
 * first, so a child leaves before its parent (#477), then oldest use; a key the latest cut read is
 * never listed.
 */
/** Levels and age steps the rank tells apart, the request's priority field split in two halves. */
export const EVICT_LEVELS = 32,
  EVICT_AGES = (REQUEST_PRIORITY_MAX + 1) / EVICT_LEVELS
/** A key word: the canonical page on twenty-seven bits — 134,217,728 packed instances —, the level
 *  in the five above, as many as `EVICT_LEVELS` tells apart. */
export const KEY_PAGE_BITS = 27
export const KEY_PAGE_MAX = 2 ** KEY_PAGE_BITS
const keyWord = (page: number, level: number) =>
  ((Math.min(EVICT_LEVELS - 1, level) << KEY_PAGE_BITS) | page) >>> 0
const keyLevel = (word: number) => word >>> KEY_PAGE_BITS

/** Writes the key column at `words[at]`, one word per page in packing order (`layout.ts`). */
export function writeKeyColumn(roots: readonly DagRoot[], words: Uint32Array, at: number) {
  const first = new Map<string, number>()
  let page = 0
  for (const root of roots)
    for (const rec of root.pages) {
      const address = pageAddress(rec),
        canonical = first.get(address),
        level = Math.max(0, Math.trunc(rec.level ?? 0))
      if (canonical === undefined) {
        first.set(address, page)
        words[at + page] = keyWord(page, level)
      } else {
        words[at + page] = canonical
        if (level > keyLevel(words[at + canonical]))
          words[at + canonical] = keyWord(canonical, level)
      }
      page++
    }
}

/** The page a key word names: where the key's last use is stamped. */
export const canonicalPage = (word: number) => word & (KEY_PAGE_MAX - 1)
