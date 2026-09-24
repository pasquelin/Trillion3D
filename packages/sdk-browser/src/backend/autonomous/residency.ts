import type { PageRec } from '../../page/selection/selection.ts';
import { releaseGeometry, type createAutonomousGeometry } from './geometry.ts';

type ResidencyEnvironment = {
  bootstrapUrls: Set<string>;
  modifiedPages: Set<string>;
  shown: PageRec[];
  desired: PageRec[];
  pending: string[];
  retained: string[];
  byUrl: Map<string, PageRec[]>;
  geometryStore: ReturnType<typeof createAutonomousGeometry>;
};

export function createAutonomousResidency(env: ResidencyEnvironment) {
  const { bootstrapUrls, modifiedPages, shown, desired, pending, retained, byUrl, geometryStore } =
    env;
  const { detach } = geometryStore;
  const state = { cacheEvictions: 0 };
  // Two sets for the life of the host: a frame fills and clears them, it does not allocate them.
  const seen = new Set<string>(),
    kept = new Set<string>();
  /** The pages the image keeps — the root cover, the host's own, the cut drawn and the cut
   *  wanted —, gathered once per image: the pool's eviction and the streamer's pins read it. */
  const collectKept = () => {
    kept.clear();
    for (const url of bootstrapUrls) kept.add(url);
    for (const url of modifiedPages) kept.add(url);
    for (const rec of shown) kept.add(rec.url);
    for (const rec of desired) kept.add(rec.url);
  };
  collectKept();
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
    collectKept,
    keptUrls: (): ReadonlySet<string> => kept,
    /** The streamer's pins: the set the image gathered, not gathered again. */
    pageUrls() {
      retained.length = 0;
      for (const url of kept) retained.push(url);
      return retained;
    },
    /** Gives a page's geometry back, in every record that draws it: one eviction per page, as the
     *  WebGPU page cache counts them, and none for a page that held nothing. */
    dropPage(url: string) {
      if (bootstrapUrls.has(url) || modifiedPages.has(url)) return;
      const recs = byUrl.get(url);
      if (!recs) return;
      let held = false;
      for (const rec of recs) {
        held ||= !!rec.array;
        detach(rec);
        releaseGeometry(geometryStore.state, rec);
        rec.geometry = undefined;
        rec.mesh = undefined;
        rec.array = undefined;
      }
      if (!held) return;
      state.cacheEvictions++;
      geometryStore.state.residentPages--;
    },
  };
}
