import { pageAddress } from '../../webgpu/row/pageSlots.ts'
import { REQUEST_PRIORITY_MAX } from './request.ts'
import type { DagRoot } from './types.ts'

/**
 * The EVICTION QUEUE the GPU cut publishes on its readback (#872, `shader/evictWgsl.ts`). The cache
 * evicts per content key (`pageAddress`), and so does the GPU: a record names its key, a key's word
 * names its address's first page — its CANONICAL page, the one the queue lists — in its low
 * `KEY_PAGE_BITS`, and carries the key's coarsest level (#824) in the five above; its last use is
 * the key's own word. Finer level first, so a child leaves before its parent (#477), then oldest
 * use; a key the latest cut read is never listed.
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

/** The content keys of `roots`, one per page address (`pageAddress`): how many the key words hold. */
export function keyCount(roots: readonly DagRoot[]) {
  const addresses = new Set<string>(),
    seen = new Set<DagRoot['pages']>()
  for (const { pages } of roots)
    if (!seen.has(pages)) {
      seen.add(pages)
      for (const rec of pages) addresses.add(pageAddress(rec))
    }
  return Math.max(1, addresses.size)
}

/**
 * Writes the content keys of a packing: each unique record's key at `words[recordKeyAt + r]`, and
 * each key's word at `words[keyWordAt + k]` — its canonical page, the first page of its address in
 * packing order, where every placement stamps, and its coarsest level. Placement `w`'s pages read
 * records from `pageBase + recordShift[w]` (`layout.ts`): one record serves every placement of its
 * primitive, and so does its key — no word per page.
 */
export function writeKeyTables(
  roots: readonly DagRoot[],
  places: { cutLinks: readonly { pageBase: number }[]; recordShift: Uint32Array },
  words: Uint32Array,
  at: { recordKey: number; keyWord: number },
) {
  const keyOf = new Map<string, number>(),
    written = new Map<DagRoot['pages'], Set<number>>()
  roots.forEach((root, w) => {
    const pageBase = places.cutLinks[w].pageBase,
      recordBase = (pageBase + places.recordShift[w]) >>> 0
    // A page array placed again on the records it already has names the same keys: once each.
    let bases = written.get(root.pages)
    if (!bases) written.set(root.pages, (bases = new Set()))
    if (bases.has(recordBase)) return
    bases.add(recordBase)
    root.pages.forEach((rec, p) => {
      const address = pageAddress(rec),
        level = Math.max(0, Math.trunc(rec.level ?? 0))
      let k = keyOf.get(address)
      if (k === undefined) {
        keyOf.set(address, (k = keyOf.size))
        words[at.keyWord + k] = keyWord(pageBase + p, level)
      } else if (level > keyLevel(words[at.keyWord + k]))
        words[at.keyWord + k] = keyWord(canonicalPage(words[at.keyWord + k]), level)
      words[at.recordKey + recordBase + p] = k
    })
  })
}

/** The page a key word names: where the key's last use is stamped. */
export const canonicalPage = (word: number) => word & (KEY_PAGE_MAX - 1)
