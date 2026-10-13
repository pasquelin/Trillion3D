import type { HostRetentionDelta, StreamContext } from './types.ts'

/** The pages the session keeps (`pinned`): each counted by its owners, the cells' frame and the
 *  engine's rank delta. A page with an owner is held in the cache whatever its transfer; each pin
 *  that comes or goes is told to `sync`, which marks it in the cache's eviction order, and the
 *  cache then evicts what no longer fits. */
export function createStreamingPins(
  context: StreamContext,
  sync: (url: string) => void,
  evict: () => void,
) {
  const { pinned, emit, catalog } = context
  /** The pages the engine's rank delta pins: a page off the catalogue is no pin. */
  const ranked = new Set<string>()
  const add = (url: string) => {
    if (!catalog.has(url)) return false
    pinned.set(url, (pinned.get(url) ?? 0) + 1)
    sync(url)
    return true
  }
  const release = (url: string) => {
    const owners = pinned.get(url)
    if (!owners) return
    if (owners > 1) pinned.set(url, owners - 1)
    else pinned.delete(url)
    sync(url)
  }
  /** One more owner of `url`'s page: its hold lasts till `unpin`. */
  const pin = (url: string) => void add(url)
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
  /** URLs designated by ranks in `urls`; a rank off the table designates nothing. */
  function* rankUrls(urls: readonly string[], ranks: ArrayLike<number>, count: number) {
    for (let i = 0; i < count; i++) {
      const url = urls[ranks[i]]
      if (url !== undefined) yield url
    }
  }
  /** Pins by rank delta: only what moved is touched, a frame that keeps the same set touches
   *  nothing at all. */
  const retainRanks = (delta: HostRetentionDelta) => {
    if (!delta.enteredCount && !delta.exitedCount) return false
    const { urls, entered, exited } = delta
    let removed = 0,
      added = 0
    for (let i = 0; i < delta.exitedCount; i++) {
      const url = urls[exited[i]]
      if (url !== undefined && ranked.delete(url)) {
        removed++
        release(url)
      }
    }
    for (const url of rankUrls(urls, entered, delta.enteredCount))
      if (!ranked.has(url) && add(url)) {
        ranked.add(url)
        added++
      }
    evict()
    emitRetain(delta.heldCount, added, removed)
    return true
  }
  return { pin, unpin, retainRanks }
}
