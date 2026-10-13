import type { EvictionOrder } from './eviction.ts'

/** An order the GPU publishes over `keys`, made with `arrivals` in the cache — every page there
 *  then, by default —, its first `old` keys old, open while `open` says so (`eviction.ts`). */
export const orderOf = (
  keys: readonly string[],
  arrivals = Number.MAX_SAFE_INTEGER,
  old = keys.length,
  open = () => true,
): EvictionOrder => ({ count: keys.length, keyAt: (at) => keys[at], old, arrivals, open })

/** What a cut that uses none of `keys` publishes: the cache gives them up, in that order. */
export function giveUp(
  cache: { evictInOrder(order?: EvictionOrder): void; readonly arrivals: number },
  ...keys: string[]
) {
  cache.evictInOrder(orderOf(keys, cache.arrivals))
}
