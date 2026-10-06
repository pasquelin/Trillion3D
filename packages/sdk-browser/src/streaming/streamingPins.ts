import type { HostRetentionDelta, StreamContext } from './types.ts'

/** The pages a frame keeps (`pinned`), set from an address list (`retain`) or a rank delta
 *  (`retainRanks`). Each pin that changes is told to `sync`, which marks it in the cache's
 *  eviction order, and the cache then evicts what no longer fits. */
export function createStreamingPins(
  context: StreamContext,
  sync: (url: string) => void,
  evict: () => void,
) {
  const { pinned, emit, catalog } = context
  /** The next full membership, built beside the pins so that only the difference is applied. */
  const next = new Set<string>()
  const pin = (url: string) => {
    pinned.add(url)
    sync(url)
  }
  const unpin = (url: string) => {
    pinned.delete(url)
    sync(url)
  }
  /**
   * Addresses the frame keeps. The pinned set is a function of this one list and of the
   * catalogue, which never moves: a list identical to the previous frame's therefore
   * describes exactly the pins already set, and resetting them one by one would change none.
   * The comparison is a pass of string identities, without hashing; reclaiming space is not
   * skipped for all that — each finished transfer replays it on its side.
   */
  const retained: string[] = []
  const same = (urls: readonly string[]) => {
    if (urls.length !== retained.length) return false
    for (let i = 0; i < urls.length; i++) if (retained[i] !== urls[i]) return false
    return true
  }
  /** Emitter of the last rank delta applied, or `null` when pins come from
   *  elsewhere — from an address list, or from another engine. The next delta then resets
   *  full membership before following ranks again. */
  let rankOwner: readonly string[] | null = null
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
  /** Reset full membership: pins are exactly the `urls` known to the catalogue. */
  const resetPins = (urls: Iterable<string>, requested: number) => {
    const before = pinned.size
    next.clear()
    for (const url of urls) if (catalog.has(url)) next.add(url)
    // Only the pins that change are marked: a list that moves little moves the order little.
    for (const url of pinned) if (!next.has(url)) unpin(url)
    for (const url of next) if (!pinned.has(url)) pin(url)
    evict()
    emitRetain(requested, pinned.size, before)
    return true
  }
  /** URLs designated by ranks in `urls`; a rank off the table designates nothing. */
  function* rankUrls(urls: readonly string[], ranks: ArrayLike<number>, count: number) {
    for (let i = 0; i < count; i++) {
      const url = urls[ranks[i]]
      if (url !== undefined) yield url
    }
  }
  const retain = (urls: readonly string[]) => {
    if (rankOwner === null && same(urls)) return false
    rankOwner = null
    retained.length = urls.length
    for (let i = 0; i < urls.length; i++) retained[i] = urls[i]
    return resetPins(urls, urls.length)
  }
  /**
   * Pins by rank delta. The common case only touches what moved; a frame that keeps the
   * same set touches nothing at all. Resume after another emitter resets full membership
   * once, then continues by delta.
   */
  const retainRanks = (delta: HostRetentionDelta) => {
    const { urls, entered, exited } = delta
    if (rankOwner !== urls) {
      rankOwner = urls
      retained.length = 0
      const { held, heldCount } = delta
      return resetPins(rankUrls(urls, held, heldCount), heldCount)
    }
    if (!delta.enteredCount && !delta.exitedCount) return false
    let removed = 0
    for (let i = 0; i < delta.exitedCount; i++) {
      const url = urls[exited[i]]
      if (url !== undefined && pinned.has(url)) {
        removed++
        unpin(url)
      }
    }
    const before = pinned.size
    for (const url of rankUrls(urls, entered, delta.enteredCount))
      if (catalog.has(url) && !pinned.has(url)) pin(url)
    evict()
    emitRetain(delta.heldCount, pinned.size - before, removed)
    return true
  }
  return { retain, retainRanks }
}
