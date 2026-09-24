import type { PageRec } from '../../page/selection/selection.ts';
import type { createAutonomousGeometry } from './geometry.ts';

type ResidencyEnvironment = {
  bootstrapUrls: Set<string>;
  modifiedPages: Set<string>;
  shown: PageRec[];
  desired: PageRec[];
  /** The lists `pendingUrls` and `pageUrls` rewrite, from image to image. */
  pending?: string[];
  retained?: string[];
  geometryStore: ReturnType<typeof createAutonomousGeometry>;
};

export function createAutonomousResidency(env: ResidencyEnvironment) {
  const { bootstrapUrls, modifiedPages, shown, desired, geometryStore } = env,
    { pending = [], retained = [] } = env;
  const state = { cacheEvictions: 0 };
  // Two sets for the life of the host: a frame fills and clears them, it does not allocate them.
  const seen = new Set<string>(),
    kept = new Set<string>();
  let keptStale = true;
  /** The pages the image keeps — the root cover, the host's own, the cut drawn and the cut
   *  wanted —, gathered once an image, and only when the pool's eviction or the streamer's pins
   *  read them. */
  const keptUrls = (): ReadonlySet<string> => {
    if (!keptStale) return kept;
    keptStale = false;
    kept.clear();
    for (const url of bootstrapUrls) kept.add(url);
    for (const url of modifiedPages) kept.add(url);
    for (const rec of shown) kept.add(rec.url);
    for (const rec of desired) kept.add(rec.url);
    return kept;
  };
  return {
    get cacheEvictions() {
      return state.cacheEvictions;
    },
    pendingUrls() {
      pending.length = 0;
      seen.clear();
      for (const rec of desired)
        if (!rec.array && !seen.has(rec.url)) {
          seen.add(rec.url);
          pending.push(rec.url);
        }
      return pending;
    },
    /** The image drew another cut: what it keeps is gathered again when next read. */
    keptChanged() {
      keptStale = true;
    },
    keptUrls,
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
