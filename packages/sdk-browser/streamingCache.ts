import type { StreamContext } from './streamingTypes.ts';

export function createStreamingCache(context: StreamContext) {
  const { cache, state, maxPages, maxCachedBytes, pinned, jobs, emit, onEvict } = context;
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
      emit('page-cache-eviction', 'Page retirée du cache LRU', () => ({
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
      emit(
        'page-cache-admission-blocked',
        'Aucune page évictable pour respecter le budget',
        () => ({
          version: 1,
          resident: cache.size,
          residentBytes: state.cachedBytes,
          maxPages: maxPages ?? null,
          maxCachedBytes,
          pinned: pinned.size,
          loading: state.active,
        }),
      );
    }
  };
  return { touch, evict };
}
