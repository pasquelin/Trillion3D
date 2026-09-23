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

/** How many pages carry their indices. A count, not an intermediate array of tens of
 *  thousands of entries allocated then thrown away on every metrics sample, i.e. every frame. */
export function comptePagesResidentes(pages: readonly PageRec[]) {
  let residentes = 0;
  for (let i = 0; i < pages.length; i++) if (pages[i].array) residentes++;
  return residentes;
}

export function createAutonomousResidency(env: ResidencyEnvironment) {
  const { bootstrapUrls, modifiedPages, shown, desired, pending, retained, byUrl, geometryStore } =
    env;
  const { detach } = geometryStore;
  const state = { cacheEvictions: 0 };
  // Two sets for the life of the host: a frame fills and clears them, it does not allocate them.
  const seen = new Set<string>(),
    uniques = new Set<string>();
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
    pageUrls() {
      retained.length = 0;
      uniques.clear();
      for (const url of bootstrapUrls) uniques.add(url);
      for (const url of modifiedPages) uniques.add(url);
      for (const rec of shown) uniques.add(rec.url);
      for (const rec of desired) uniques.add(rec.url);
      for (const url of uniques) retained.push(url);
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
      if (held) state.cacheEvictions++;
    },
  };
}
