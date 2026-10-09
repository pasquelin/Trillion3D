import { REQUEST_AHEAD } from './request.ts'
import { sortStaged, stagedPage, stagedRequest } from './request.fixture.ts'
import { EVICT_LEVELS, EVICT_AGES, KEY_PAGE_BITS, canonicalPage } from './evict.ts'
import { keyWordBase, recordKeyBase } from './layout.ts'
import type { PackedDag } from './types.ts'
import { rootOfPacked } from '../../page/selection/placements.ts'

/** CPU mirror of `dagListEvictions`: the pool's listed content keys (`poolList.ts`) not stamped
 *  `now`, by `evictionRank` through `sortStaged`, the first `cap`, each as its canonical page;
 *  within a rank, page order. */
export function listEvictions(options: {
  pool: Iterable<number>
  keyWords: Uint32Array
  stampOf: (key: number) => number
  now: number
  cap: number
}) {
  const { pool, keyWords, stampOf, now, cap } = options
  const words: number[] = []
  for (const key of pool) {
    const used = stampOf(key),
      page = canonicalPage(keyWords[key])
    if (used !== now)
      words.push(stagedRequest(page, evictionRank(keyWords[key], now - used) ^ REQUEST_AHEAD))
  }
  return sortStaged(words).slice(0, Math.max(0, cap)).map(stagedPage)
}

/** The content key of `packed`'s page `page`, through its record (`layout.ts`), and the key words. */
export function pageKeys(packed: PackedDag) {
  const cold = new Uint32Array(packed.pageCones.buffer, packed.pageCones.byteOffset)
  const recordKeys = cold.subarray(recordKeyBase(packed.pageCount)),
    keyWords = cold.subarray(keyWordBase(packed))
  const keyOf = (page: number) =>
    recordKeys[(page + packed.recordShift[rootOfPacked(packed.pageIndex, page)]) >>> 0]
  return { keyOf, keyWords, keyWordOf: (page: number) => keyWords[keyOf(page)] }
}

/** Rank of a key in the queue, highest evicted first: finer level, then older use. Integer only,
 *  as the kernel's: the age step is the bit length of the age, one step per doubling. A key's five
 *  level bits never pass `EVICT_LEVELS - 1`. */
function evictionRank(keyWord: number, age: number) {
  const level = keyWord >>> KEY_PAGE_BITS,
    step = Math.min(EVICT_AGES - 1, 32 - Math.clz32(age >>> 0))
  return ((EVICT_LEVELS - 1 - level) * EVICT_AGES) | step
}
