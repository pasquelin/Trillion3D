import { pageAddress } from '../../webgpu/row/pageSlots.ts';
import {
  REQUEST_AHEAD,
  REQUEST_PAGE_BITS as KEY_PAGE_BITS,
  REQUEST_PRIORITY_MAX as LEVEL_MAX,
  packRequest,
  requestPage,
  requestPriority,
  sortRequestWords,
} from './request.ts';
import type { DagRoot } from './types.ts';

/**
 * The EVICTION QUEUE the GPU cut publishes on its readback (#872, `shader/evictWgsl.ts`). The cache
 * evicts per content key (`pageAddress`), the GPU stamps per placement: each page's word in the key
 * column names its address's first page, its CANONICAL page, where every placement stamps — so that
 * stamp is the key's last use — and whose word carries the key's coarsest level (#824). Order: finer
 * level first, so a child leaves before its parent (#477), then oldest use first; a key the latest
 * cut read is never listed; at most the pool's slots.
 */

/** A key word is a request word (`request.ts`): the canonical page below, the level above. */
export { KEY_PAGE_BITS };
/** Levels and age steps the rank tells apart: the two halves of the request word's rank field. */
export const EVICT_LEVELS = 32,
  EVICT_AGES = (LEVEL_MAX + 1) / EVICT_LEVELS;

/** Writes the key column at `words[at]`, one word per page in packing order (`../layout.ts`). */
export function writeKeyColumn(roots: readonly DagRoot[], words: Uint32Array, at: number) {
  const first = new Map<string, number>();
  let page = 0;
  for (const root of roots)
    for (const rec of root.pages) {
      const address = pageAddress(rec),
        canonical = first.get(address),
        level = Math.min(LEVEL_MAX, Math.max(0, Math.trunc(rec.level ?? 0)));
      if (canonical === undefined) {
        first.set(address, page);
        words[at + page] = packRequest(page, level);
      } else {
        words[at + page] = canonical;
        if (level > requestPriority(words[at + canonical]))
          words[at + canonical] = packRequest(canonical, level);
      }
      page++;
    }
}

/** The page a key word names: where the key's last use is stamped. */
export const canonicalPage = requestPage;

/** Rank of a key in the queue, highest evicted first: finer level, then older use. Integer only,
 *  as the kernel's: the age step is the bit length of the age, one step per doubling. */
export function evictionRank(keyWord: number, age: number) {
  const level = Math.min(EVICT_LEVELS - 1, requestPriority(keyWord)),
    step = Math.min(EVICT_AGES - 1, 32 - Math.clz32(age >>> 0));
  return ((EVICT_LEVELS - 1 - level) * EVICT_AGES) | step;
}

/** CPU mirror of `dagListEvictions`: the canonical pages in `pool` not stamped `now`, sorted by
 *  `evictionRank` through `sortRequestWords`, the first `cap`; within a rank, page order. */
export function listEvictions(options: {
  pool: Uint32Array;
  keys: Uint32Array;
  stampOf: (page: number) => number;
  now: number;
  cap: number;
}) {
  const { pool, keys, stampOf, now, cap } = options;
  const words: number[] = [];
  for (let w = 0; w < pool.length; w++)
    for (let bits = pool[w]; bits !== 0; bits &= bits - 1) {
      const page = w * 32 + (31 - Math.clz32(bits & -bits)),
        used = stampOf(page);
      if (used === now) continue;
      words.push(packRequest(page, evictionRank(keys[page], now - used) ^ REQUEST_AHEAD));
    }
  return Array.from(sortRequestWords(words).subarray(0, Math.max(0, cap)), requestPage);
}
