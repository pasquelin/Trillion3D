/**
 * THE EVICTION RANK of every GPU pool (#1527): geometry pages, texture tiles, row table slots and
 * shadow pages. The GPU stamps a last-use word on each slot where it is read, ranks the slots by
 * that word, and a counting sort publishes the highest ranks as the victim queue (`sortWgsl.ts`).
 *
 * A rank is an AGE STEP — a doubling of the age, its bit length — then a TIER inside the step: an
 * older slot leaves first, and among slots of one step the higher rank of its tier first. The tier
 * is the level for pages and tiles — the finer first, so a child leaves before its parent (#477) —,
 * 0 for rows. A slot read less than `inUse` frames ago is in use and never ranked (`POOL_RANKS`).
 */
/** Ranks a pool tells apart: `POOL_TIERS` tiers in each of `POOL_AGES` age steps. */
export const POOL_RANKS = 1024,
  POOL_TIERS = 32,
  POOL_AGES = POOL_RANKS / POOL_TIERS
/**
 * Frames a use protects its slot for: the frame that used it and the one after, so a slot any view
 * — a light's, a view drawn beside the main one — used in the frame before is still in use, whatever
 * order the views read in. A page the view AHEAD of the camera asks for counts as used this many
 * frames ago: ranked after every page older than that, before any page in use.
 */
export const EVICT_IN_USE = 2
/** The first age step of the OLD slots: older than any page the view ahead asks for. The queue's
 *  head of old slots is what a page of the view ahead may take the place of (`evictOld`). */
export const OLD_STEP = 32 - Math.clz32(EVICT_IN_USE) + 1
