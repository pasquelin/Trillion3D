import type { EvictionOrder } from './eviction.ts'

/** An order a GPU sort publishes over `keys`, made with `arrivals` in the pool — every page there
 *  then, by default (`eviction.ts`). */
export const orderOf = (
  keys: readonly string[],
  arrivals = Number.MAX_SAFE_INTEGER,
): EvictionOrder => ({ count: keys.length, keyAt: (at) => keys[at], arrivals })
