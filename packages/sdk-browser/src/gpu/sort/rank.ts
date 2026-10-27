/**
 * THE EVICTION RANK of every GPU pool (#1527): texture tiles and shadow pages.
 * The GPU stamps a last-use word on each slot where it is read, ranks the slots by
 * that word, and a counting sort publishes the highest ranks as the victim queue (`sortWgsl.ts`).
 *
 * A rank is an AGE STEP — the pool's own `poolAgeStep`; a pool without its own gets the doubling of
 * the age, its bit length (`rankWgsl.ts`) — then a TIER inside the step: an older slot leaves first,
 * and among slots of one step the higher rank of its tier first. The tier
 * is the level for shadow pages and tiles — the finer first, so a child leaves before its parent
 * (#477) —, 0 for tiles with no level. A slot read less than `inUse` frames ago is in use and never ranked (`POOL_RANKS`).
 */
/** Ranks a pool tells apart: `POOL_TIERS` tiers in each of `POOL_AGES` age steps. */
export const POOL_RANKS = 1024,
  POOL_TIERS = 32,
  POOL_AGES = POOL_RANKS / POOL_TIERS
