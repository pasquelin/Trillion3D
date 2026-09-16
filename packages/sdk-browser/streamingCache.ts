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
  /**
   * Les adresses que l'image garde. L'ensemble épinglé est fonction de cette seule liste et du
   * catalogue, qui ne bouge plus : une liste identique à celle de l'image précédente décrit donc
   * exactement les épingles déjà posées, et la reposer une à une n'en changerait aucune. La
   * comparaison est une passe d'identités de chaînes, sans hachage ; la reprise de place, elle,
   * n'est pas sautée pour autant — chaque transfert terminé la rejoue de son côté.
   */
  const retained: string[] = [];
  const same = (urls: readonly string[]) => {
    if (urls.length !== retained.length) return false;
    for (let i = 0; i < urls.length; i++) if (retained[i] !== urls[i]) return false;
    return true;
  };
  /** L'émetteur de la dernière différence de rangs appliquée, ou `null` quand les épingles viennent
   *  d'ailleurs — d'une liste d'adresses, ou d'un autre moteur. La différence suivante reprend alors
   *  l'appartenance entière avant de suivre les rangs à nouveau. */
  let rankOwner: readonly string[] | null = null;
  /** Les épingles publiées en comptes : `added` et `removed` ne sont plus des listes recopiées à
   *  chaque image, mais ce que la différence appliquée vient d'ajouter et de retirer. */
  const emitRetain = (requested: number, added: number, removed: number) =>
    emit('page-retain', 'Épingles de pages mises à jour', () => ({
      version: 1,
      requested,
      retained: pinned.size,
      changed: true,
      added,
      removed,
    }));
  const pinRank = (urls: readonly string[], rank: number) => {
    const url = urls[rank];
    if (url !== undefined && catalog.has(url)) pinned.add(url);
  };
  const retain = (urls: readonly string[]) => {
    if (rankOwner === null && same(urls)) return false;
    rankOwner = null;
    retained.length = urls.length;
    for (let i = 0; i < urls.length; i++) retained[i] = urls[i];
    const before = pinned.size;
    pinned.clear();
    for (const url of urls) if (catalog.has(url)) pinned.add(url);
    evict();
    emitRetain(urls.length, pinned.size, before);
    return true;
  };
  /**
   * Les épingles par différence de rangs. Le cas courant ne touche que ce qui a bougé ; une image qui
   * garde le même ensemble ne touche rien du tout. La reprise après un autre émetteur repose
   * l'appartenance entière, une fois, puis repart en différence.
   */
  const retainRanks = (delta: HostRetentionDelta) => {
    const { urls, entered, exited } = delta;
    if (rankOwner !== urls) {
      rankOwner = urls;
      retained.length = 0;
      const { held, heldCount } = delta;
      const before = pinned.size;
      pinned.clear();
      for (let i = 0; i < heldCount; i++) pinRank(urls, held[i]);
      evict();
      emitRetain(heldCount, pinned.size, before);
      return true;
    }
    if (!delta.enteredCount && !delta.exitedCount) return false;
    let removed = 0;
    for (let i = 0; i < delta.exitedCount; i++) {
      const url = urls[exited[i]];
      if (url !== undefined && pinned.delete(url)) removed++;
    }
    const before = pinned.size;
    for (let i = 0; i < delta.enteredCount; i++) pinRank(urls, entered[i]);
    evict();
    emitRetain(delta.heldCount, pinned.size - before, removed);
    return true;
  };
  return { touch, evict, retain, retainRanks };
}
