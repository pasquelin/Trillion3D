import type { HostRetentionDelta, StreamContext } from './streamingTypes.ts';

export function createStreamingCache(context: StreamContext) {
  const { cache, state, maxPages, maxCachedBytes, pinned, jobs, emit, onEvict, catalog } = context;
  const touch = (url: string, array: Uint8Array) => {
    const held = cache.get(url);
    if (held) state.cachedBytes -= held.byteLength;
    cache.delete(url);
    cache.set(url, array);
    state.cachedBytes += array.byteLength;
  };
  const over = () =>
    (maxPages && maxPages >= 1 && cache.size > maxPages) || state.cachedBytes > maxCachedBytes;
  const evict = () => {
    if (!over()) return;
    let evicted = false;
    for (const url of cache.keys()) {
      if (!over()) break;
      if (pinned.has(url) || jobs.has(url)) continue;
      const held = cache.get(url);
      if (held) state.cachedBytes -= held.byteLength;
      cache.delete(url);
      state.evictions++;
      evicted = true;
      emit('page-cache-eviction', 'Page evicted from the LRU cache', () => ({
        version: 1,
        url,
        reason: 'capacity',
        drawDetached: false,
        resident: cache.size,
        residentBytes: state.cachedBytes,
        maxPages: maxPages ?? null,
        maxCachedBytes,
      }));
      onEvict?.(url);
    }
    if (!evicted && over()) {
      state.admissionBlocked++;
      emit('page-cache-admission-blocked', 'No evictable page to meet the budget', () => ({
        version: 1,
        resident: cache.size,
        residentBytes: state.cachedBytes,
        maxPages: maxPages ?? null,
        maxCachedBytes,
        pinned: pinned.size,
        loading: state.active,
      }));
    }
  };
  /**
   * Addresses the frame keeps. The pinned set is a function of this one list and of the
   * catalogue, which no longer moves: a list identical to the previous frame's therefore
   * describes exactly the pins already set, and resetting them one by one would change none.
   * The comparison is a pass of string identities, without hashing; reclaiming space is not
   * skipped for all that — each finished transfer replays it on its side.
   */
  const retained: string[] = [];
  const same = (urls: readonly string[]) => {
    if (urls.length !== retained.length) return false;
    for (let i = 0; i < urls.length; i++) if (retained[i] !== urls[i]) return false;
    return true;
  };
  /** Emitter of the last rank delta applied, or `null` when pins come from
   *  elsewhere — from an address list, or from another engine. The next delta then resets
   *  full membership before following ranks again. */
  let rankOwner: readonly string[] | null = null;
  /** Pins published as counts: `added` and `removed` are no longer lists copied each
   *  frame, but what the applied delta just added and removed. */
  const emitRetain = (requested: number, added: number, removed: number) =>
    emit('page-retain', 'Page pins updated', () => ({
      version: 1,
      requested,
      retained: pinned.size,
      changed: true,
      added,
      removed,
    }));
  /** Reset full membership: pins are exactly the `urls` known to the catalogue. */
  const resetPins = (urls: Iterable<string>, requested: number) => {
    const before = pinned.size;
    pinned.clear();
    for (const url of urls) if (catalog.has(url)) pinned.add(url);
    evict();
    emitRetain(requested, pinned.size, before);
    return true;
  };
  /** URLs designated by ranks in `urls`; a rank off the table designates nothing. */
  function* rankUrls(urls: readonly string[], ranks: ArrayLike<number>, count: number) {
    for (let i = 0; i < count; i++) {
      const url = urls[ranks[i]];
      if (url !== undefined) yield url;
    }
  }
  const retain = (urls: readonly string[]) => {
    if (rankOwner === null && same(urls)) return false;
    rankOwner = null;
    retained.length = urls.length;
    for (let i = 0; i < urls.length; i++) retained[i] = urls[i];
    return resetPins(urls, urls.length);
  };
  /**
   * Pins by rank delta. The common case only touches what moved; a frame that keeps the
   * same set touches nothing at all. Resume after another emitter resets full membership
   * once, then continues by delta.
   */
  const retainRanks = (delta: HostRetentionDelta) => {
    const { urls, entered, exited } = delta;
    if (rankOwner !== urls) {
      rankOwner = urls;
      retained.length = 0;
      const { held, heldCount } = delta;
      return resetPins(rankUrls(urls, held, heldCount), heldCount);
    }
    if (!delta.enteredCount && !delta.exitedCount) return false;
    let removed = 0;
    for (let i = 0; i < delta.exitedCount; i++) {
      const url = urls[exited[i]];
      if (url !== undefined && pinned.delete(url)) removed++;
    }
    const before = pinned.size;
    for (const url of rankUrls(urls, entered, delta.enteredCount))
      if (catalog.has(url)) pinned.add(url);
    evict();
    emitRetain(delta.heldCount, pinned.size - before, removed);
    return true;
  };
  return { touch, evict, retain, retainRanks };
}
