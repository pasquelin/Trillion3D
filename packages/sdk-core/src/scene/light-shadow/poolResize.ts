import { RANKS, type ShadowPool } from './pool.ts';
import { shadowPageArrays, type ShadowPageArrays } from './poolPages.ts';
import { PAGE_INDEX_MASK } from './virtual.ts';
import type { ShadowTable } from './table.ts';

/** What a page carries to its new place besides its entry: every other page array. */
const CARRIED = (Object.keys(shadowPageArrays(0)) as (keyof ShadowPageArrays)[]).filter(
  (key) => key !== 'owner',
);

/**
 * THE POOL FOLLOWS A RESIZE WITHOUT LOSING WHAT IT HOLDS: `pool` takes `side² × layers` pages,
 * and every mapped page it has room for keeps its entry, its depth — copied texel for texel to its
 * new place by the GPU (`webgpu/shadow/poolResize.ts` of sdk-browser) — and its whole state:
 * current or stale, layered or not, asked when it was. Nothing is drawn again for the resize.
 *
 * The pages kept are those the pool would evict last — the most recently asked, then the
 * coarsest, so every floor before a finer page —, packed from page 0 in their old order: a pool
 * that grows keeps them all. What a smaller pool has no room for is released as an eviction
 * releases it, its entry reading nothing: a reader falls back to the coarser page kept under it
 * and the next report asks for it again.
 *
 * Returns, for every page of the old pool, its page in the new one, or −1.
 */
export function resizeShadowPool(
  pool: ShadowPool,
  table: ShadowTable,
  side: number,
  layers: number,
) {
  const before: ShadowPageArrays = { ...pool },
    moved = new Int32Array(pool.pages).fill(-1),
    room = side * side * layers,
    mapped: number[] = [];
  for (let page = 0; page < pool.pages; page++) if (pool.owner[page] >= 0) mapped.push(page);
  const key = (page: number) => (pool.requested[page] + 1) * RANKS + pool.rank[page];
  mapped.sort((a, b) => key(b) - key(a) || a - b);
  for (const page of mapped.slice(room)) pool.release(table, page);
  const kept = mapped.slice(0, room).sort((a, b) => a - b),
    words = kept.map((page) => table.words[before.owner[page]]);
  pool.resize(side, layers);
  // A fresh pool hands its free pages out from page 0 up.
  for (const [i, page] of kept.entries()) {
    const entry = before.owner[page],
      to = pool.take(table, entry, before.requested[page], 0, 0);
    for (const field of CARRIED) pool[field][to] = before[field][page];
    table.write(entry, (words[i] & ~PAGE_INDEX_MASK) | to);
    moved[page] = to;
  }
  return moved;
}
