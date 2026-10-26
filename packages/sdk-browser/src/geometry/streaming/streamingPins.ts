import type { HostRetentionDelta, StreamContext } from './types.ts'
import { countBy } from '../../../../math/src/sequence/counts.ts'

/** `visit` each URL designated by the first `count` of `ranks` in `urls`; a rank off the table
 *  designates nothing. How many were visited. */
export function eachRankUrl(
  urls: readonly string[],
  ranks: ArrayLike<number>,
  count: number,
  visit: (url: string) => void,
) {
  let visited = 0
  for (let i = 0; i < count; i++) {
    const url = urls[ranks[i]]
    if (url === undefined) continue
    visit(url)
    visited++
  }
  return visited
}

/** The pages the session keeps: each owner — a view's ask, the engine's rank delta — holds its
 *  page in the cache's one refcount (`cacheEntries.ts`) from its pin to its unpin, landed or not;
 *  `pinned` lists the session's owners, to give them back at its close. The cache then evicts what
 *  no longer fits (`evict`). */
export function createStreamingPins(context: StreamContext, evict: () => void) {
  const { pinned, emit, store } = context
  /** One more owner of `url`'s page: its hold lasts till `unpin`. */
  const pin = (url: string) => {
    countBy(pinned, url, 1)
    store.acquire(url)
  }
  const release = (url: string) => {
    if (!pinned.get(url)) return
    countBy(pinned, url, -1)
    store.release(url)
  }
  /** One owner of `url`'s page lets it go; the cache evicts what no longer fits. */
  const unpin = (url: string) => {
    release(url)
    evict()
  }
  /** Pins published as counts: `added` and `removed` are not lists copied each
   *  frame, but what the applied delta just added and removed. */
  const emitRetain = (requested: number, added: number, removed: number) =>
    emit?.('page-retain', 'Page pins updated', () => ({
      version: 1,
      requested,
      retained: pinned.size,
      changed: true,
      added,
      removed,
    }))
  /** Pins by rank delta: only what moved is touched, a frame that keeps the same set touches
   *  nothing at all. Each rank entered is one owner till it exits. */
  const retainRanks = (delta: HostRetentionDelta) => {
    if (!delta.enteredCount && !delta.exitedCount) return false
    const { urls, entered, exited } = delta
    const removed = eachRankUrl(urls, exited, delta.exitedCount, release),
      added = eachRankUrl(urls, entered, delta.enteredCount, pin)
    evict()
    emitRetain(delta.heldCount, added, removed)
    return true
  }
  return { pin, unpin, retainRanks }
}
