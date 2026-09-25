import type { PageRec } from '../../page/selection/selection.ts';
import type { createAutonomousGeometry } from './geometry.ts';

type ResidencyEnvironment = {
  bootstrapUrls: Set<string>;
  modifiedPages: Set<string>;
  shown: PageRec[];
  /** What the image asks the pool for: the wanted cut closed over its groups, as far as the pool
   *  admits it (`requests.ts`, `pool.ts`). */
  requested: PageRec[];
  geometryStore: ReturnType<typeof createAutonomousGeometry>;
};

export function createAutonomousResidency(env: ResidencyEnvironment) {
  const { bootstrapUrls, modifiedPages, shown, requested, geometryStore } = env;
  /** The lists `pendingUrls` and `pageUrls` rewrite, from image to image. */
  const pending: string[] = [],
    retained: string[] = [];
  const state = { cacheEvictions: 0 };
  // Two sets for the life of the host: a frame fills and clears them, it does not allocate them.
  const kept = new Set<string>(),
    asked = new Set<string>();
  let keptStale = true,
    askedStale = true;
  /** The root cover, the host's own, `drawn` when given, and what the image asks for. */
  const gather = (into: Set<string>, drawn?: readonly PageRec[]) => {
    into.clear();
    for (const url of bootstrapUrls) into.add(url);
    for (const url of modifiedPages) into.add(url);
    if (drawn) for (const rec of drawn) into.add(rec.url);
    for (const rec of requested) into.add(rec.url);
    return into;
  };
  /** The pages the image keeps — the root cover, the host's own, the cut it drew and what it asks
   *  for —, gathered once an image, and only when the pool's eviction or the streamer's pins read
   *  them. */
  const keptUrls = (): ReadonlySet<string> => {
    if (keptStale) gather(kept, shown);
    keptStale = false;
    return kept;
  };
  return {
    get cacheEvictions() {
      return state.cacheEvictions;
    },
    pendingUrls() {
      // One record per page, coarsest first: the streamer takes the head.
      pending.length = 0;
      for (const rec of requested) if (!rec.array) pending.push(rec.url);
      return pending;
    },
    /** The image drew another cut: what it keeps is gathered again when next read. */
    keptChanged() {
      keptStale = askedStale = true;
    },
    keptUrls,
    /** What the pool keeps when the next cut is about to run: the kept pages but the cut drawn,
     *  which that cut draws again from what stays resident (`pool.ts`). */
    askedUrls(): ReadonlySet<string> {
      if (askedStale) gather(asked);
      askedStale = false;
      return asked;
    },
    pageUrls() {
      retained.length = 0;
      for (const url of keptUrls()) retained.push(url);
      return retained;
    },
    /** Gives a page's geometry back: one eviction per page, as the WebGPU page cache counts them,
     *  and none for a page that held nothing. */
    dropPage(url: string) {
      if (bootstrapUrls.has(url) || modifiedPages.has(url)) return;
      if (geometryStore.releasePage(url)) state.cacheEvictions++;
    },
  };
}
