import { pageAddress } from '../../webgpu/row/pageSlots.ts';
import {
  REQUEST_AHEAD,
  REQUEST_PAGE_MAX,
  REQUEST_PRIORITY_MAX,
  packRequest,
  requestPage,
  sortRequestWords,
} from './request.ts';
import type { DagRoot } from './types.ts';

/**
 * The EVICTION QUEUE the GPU cut publishes (#872): the pool's pages in the order the cache gives
 * their slots back, on the frame's one readback (`shader/evictWgsl.ts`).
 *
 * The cache evicts per CONTENT KEY — one slot per page address (`pageAddress`) — while the GPU
 * stamps last use per placement (`shader/lastUseWgsl.ts`). The key column packed here reconciles
 * them: each page names the first page of its address, its CANONICAL page, and the cut stamps
 * there, so the canonical page's stamp is the last use of the key over all its placements, with
 * no reduction and no host walk. The canonical page's word also carries the key's level: the
 * coarsest any placement brings it at (#824).
 *
 * The order: finer level first — a parent's level is above its children's, so every child leaves
 * before its parent (#477) —, then the oldest last use first. A key the latest cut drew or asked
 * for is not listed: a page read this frame is never evicted. The queue holds at most the pool's
 * slots, the rank's first ones when more are listed.
 */

/** Bits of a key word below the level: the canonical page, as a request word names a page. */
export const KEY_PAGE_BITS = Math.log2(REQUEST_PAGE_MAX);
const KEY_PAGE_MASK = REQUEST_PAGE_MAX - 1;
/** Levels and age steps the rank tells apart: the two halves of the request word's rank field. */
export const EVICT_LEVELS = 32,
  EVICT_AGES = 32;
if (EVICT_LEVELS * EVICT_AGES !== REQUEST_PRIORITY_MAX + 1)
  throw new Error('EVICTION_RANKS_MISMATCH');
const LEVEL_MAX = (1 << (32 - KEY_PAGE_BITS)) - 1;

/** Writes the key column at `words[at]`, one word per page in packing order (`../layout.ts`). */
export function writeKeyColumn(roots: readonly DagRoot[], words: Uint32Array, at: number) {
  const first = new Map<string, number>();
  let page = 0;
  for (const root of roots)
    for (const rec of root.pages) {
      const address = pageAddress(rec),
        canonical = first.get(address) ?? page,
        level = Math.min(LEVEL_MAX, Math.max(0, Math.trunc(rec.level ?? 0)));
      if (canonical === page) first.set(address, page);
      const held = canonical === page ? 0 : words[at + canonical] >>> KEY_PAGE_BITS;
      words[at + canonical] = ((Math.max(held, level) << KEY_PAGE_BITS) | canonical) >>> 0;
      if (canonical !== page) words[at + page] = canonical;
      page++;
    }
}

/** The page a key word names: where the key's last use is stamped. */
export const canonicalPage = (keyWord: number) => keyWord & KEY_PAGE_MASK;

/** Rank of a key in the queue, highest evicted first: finer level, then older use. Integer only,
 *  as the kernel's: the age step is the bit length of the age, one step per doubling. */
export function evictionRank(keyWord: number, age: number) {
  const level = Math.min(EVICT_LEVELS - 1, keyWord >>> KEY_PAGE_BITS),
    step = Math.min(EVICT_AGES - 1, 32 - Math.clz32(age >>> 0));
  return ((EVICT_LEVELS - 1 - level) * EVICT_AGES) | step;
}

/**
 * CPU mirror of `dagListEvictions`, what the Node device replays: the canonical pages the pool
 * holds (`pool`, one bit per page), less those stamped `now`, sorted by `evictionRank` through
 * `dagSortRequests`' own mirror, the first `cap` of them. Within a rank, page order: one of the
 * orders the kernel's threads give.
 */
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
      if (canonicalPage(keys[page]) !== page || used === now) continue;
      words.push(packRequest(page, evictionRank(keys[page], now - used) ^ REQUEST_AHEAD));
    }
  return Array.from(sortRequestWords(words).subarray(0, Math.max(0, cap)), requestPage);
}
