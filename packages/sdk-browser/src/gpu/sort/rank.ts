/**
 * THE EVICTION RANK of the GPU pools (#1527): the GPU stamps a last-use word on each slot where it
 * is read, the host ranks its slots (`poolSlotRank(j)`), and a counting sort publishes the highest
 * ranks as the victim queue (`sortWgsl.ts`). The texture tiles rank by age and tier
 * (`../../materials/virtual/evictSortWgsl.ts`), the shadow pool by recency alone
 * (`../../lighting/shadows/vsm/freePagesWgsl.ts`).
 */
/** Ranks a pool tells apart; a rank of `POOL_RANKS` is a slot in use, never listed. */
export const POOL_RANKS = 1024
