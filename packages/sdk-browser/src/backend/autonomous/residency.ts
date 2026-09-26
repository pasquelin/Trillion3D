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
  // One set for the life of the host: a frame fills and clears it, it does not allocate it.
  const kept = new Set<string>();
  let keptStale = true;
  /** The pages the image keeps — the root cover, the host's own, the cut it drew and what it asks
   *  for —, gathered once an image, and only when the streamer's pins read them. */
  const keptUrls = (): ReadonlySet<string> => {
    if (!keptStale) return kept;
    keptStale = false;
    kept.clear();
    for (const url of bootstrapUrls) kept.add(url);
    for (const url of modifiedPages) kept.add(url);
    for (const rec of shown) kept.add(rec.url);
    for (const rec of requested) kept.add(rec.url);
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
      keptStale = true;
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
