import type { HostRetentionDelta, StreamContext } from './types.ts';
import { evictOldest } from './evictOldest.ts';

export function createStreamingCache(context: StreamContext) {
  const { store, cache, state, maxPages, pinned, jobs, emit, onEvict, catalog } = context;
  const touch = store.touch;
  /** The page budget, read once per eviction: it sums the engine's tables, which the pages
   *  leaving do not move. */
  let budget = 0;
  const over = () => (!!maxPages && maxPages >= 1 && cache.size > maxPages) || store.bytes > budget;
  const pinnedOrLoading = (url: string) => pinned.has(url) || jobs.has(url);
  /** Bytes of the pages no eviction may take: those the frame keeps and those in flight. */
  const heldBytes = () => {
    let held = 0;
    for (const [url, page] of cache) if (pinnedOrLoading(url)) held += page.byteLength;
    return held;
  };
  const evictOne = (url: string) => {
    store.drop(url);
    state.evictions++;
    emit('page-cache-eviction', 'Page evicted from the LRU cache', () => ({
      version: 1,
      url,
      reason: 'capacity',
      drawDetached: false,
      resident: cache.size,
      residentBytes: store.bytes,
      maxPages: maxPages ?? null,
      maxCachedBytes: store.budgetBytes,
    }));
    onEvict?.(url);
  };
  const evict = () => {
    budget = store.budgetBytes;
    if (!over()) return;
    // The kept file yields to the pages the frame keeps: it never costs the image a page (#483
    // rule 1). It yields before any page leaves, so none is evicted that fits once it has gone.
    // It is read again after a device loss, and the notice says what it gave back.
    const kept = store.keptBytes;
    if (kept > 0 && heldBytes() > budget) {
      store.yieldKept();
      budget = store.budgetBytes;
      emit(
        'page-cache-kept-yielded',
        'The kept file yields its bytes to the pages kept or in flight',
        () => ({
          version: 1,
          bytes: kept,
          residentBytes: store.bytes,
          maxCachedBytes: budget,
          pinned: pinned.size,
          loading: state.active,
        }),
      );
    }
    const evicted = evictOldest(cache.keys(), over, pinnedOrLoading, evictOne);
    if (!evicted && over()) {
      state.admissionBlocked++;
      emit('page-cache-admission-blocked', 'No evictable page to meet the budget', () => ({
        version: 1,
        resident: cache.size,
        residentBytes: store.bytes,
        maxPages: maxPages ?? null,
        maxCachedBytes: store.budgetBytes,
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
  /** The engine's host tables take `bytes()` of the CPU share the cache holds
   *  (`../residency/memoryBudget.ts`): the decoded pages keep the rest. Read each time the cache
   *  weighs itself, for tables that follow the view. */
  const reserve = (bytes: () => number) => {
    state.reservedBytes = bytes;
    evict();
  };
  return { touch, evict, retain, retainRanks, reserve };
}
