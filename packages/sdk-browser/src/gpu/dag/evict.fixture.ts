import { packRequest, REQUEST_AHEAD, requestPage, requestPriority } from './request.ts'
import { sortRequestWords } from './request.fixture.ts'
import { EVICT_LEVELS, EVICT_AGES } from './evict.ts'

/** CPU mirror of `dagListEvictions`: the pool's listed pages (`poolList.ts`) not stamped `now`, by
 *  `evictionRank` through `sortRequestWords`, the first `cap`; within a rank, page order. */
export function listEvictions(options: {
  pool: Iterable<number>
  keys: Uint32Array
  stampOf: (page: number) => number
  now: number
  cap: number
}) {
  const { pool, keys, stampOf, now, cap } = options
  const words: number[] = []
  for (const page of pool) {
    const used = stampOf(page)
    if (used !== now)
      words.push(packRequest(page, evictionRank(keys[page], now - used) ^ REQUEST_AHEAD))
  }
  return Array.from(sortRequestWords(words).subarray(0, Math.max(0, cap)), requestPage)
}

/** Rank of a key in the queue, highest evicted first: finer level, then older use. Integer only,
 *  as the kernel's: the age step is the bit length of the age, one step per doubling. */
function evictionRank(keyWord: number, age: number) {
  const level = Math.min(EVICT_LEVELS - 1, requestPriority(keyWord)),
    step = Math.min(EVICT_AGES - 1, 32 - Math.clz32(age >>> 0))
  return ((EVICT_LEVELS - 1 - level) * EVICT_AGES) | step
}
