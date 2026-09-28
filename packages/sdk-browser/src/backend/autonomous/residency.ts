import type { PageRec } from '../../page/selection/selection.ts';
import type { createAutonomousGeometry } from './geometry.ts';
import { createHostRankDelta } from '../../webgpu/pages/io/hostRanks.ts';

type ResidencyEnvironment = {
  bootstrapUrls: Set<string>;
  modifiedPages: Set<string>;
  /** Every view, the main one first (`views.ts`): the cut each draws, and what each asks the pool
   *  for — its wanted cut closed over its groups, as far as the pool admits the union
   *  (`requests.ts`, `pool.ts`). */
  views: readonly { readonly shown: readonly PageRec[]; readonly requested: readonly PageRec[] }[];
  geometryStore: ReturnType<typeof createAutonomousGeometry>;
};

export function createAutonomousResidency(env: ResidencyEnvironment) {
  const { bootstrapUrls, modifiedPages, views, geometryStore } = env;
  /** The pending requests rewrite from image to image. */
  const pending: string[] = [];
  const state = { cacheEvictions: 0 };
  const queued = new Set<string>();
  let ranksStale = true;
  // A mounted page keeps its request rank for the session, including after it is unmounted.
  const rankUrls: string[] = [],
    rankByUrl = new Map<string, number>(),
    ranks = createHostRankDelta(0, rankUrls);
  const rankOf = (url: string) => {
    let rank = rankByUrl.get(url);
    if (rank === undefined) {
      rank = rankUrls.length;
      rankUrls.push(url);
      rankByUrl.set(url, rank);
      ranks.grow(rankUrls.length);
    }
    return rank;
  };
  const markRecord = (rec: PageRec) => {
    const rank = rec.requestIndex;
    if (rank !== undefined && rankUrls[rank] === rec.url) ranks.markRank(rank);
    else ranks.markRank((rec.requestIndex = rankOf(rec.url)));
  };
  return {
    get cacheEvictions() {
      return state.cacheEvictions;
    },
    pendingUrls() {
      // One record per page, coarsest first, the main view's ahead: the streamer takes the head.
      // A view's requests are one record per page (`requests.ts`): only another view's can repeat.
      pending.length = 0;
      for (const rec of views[0].requested) if (!rec.array) pending.push(rec.url);
      if (views.length === 1) return pending;
      queued.clear();
      for (const url of pending) queued.add(url);
      for (let v = 1; v < views.length; v++)
        for (const rec of views[v].requested) {
          if (rec.array || queued.has(rec.url)) continue;
          queued.add(rec.url);
          pending.push(rec.url);
        }
      return pending;
    },
    /** The image drew another cut: what it keeps is gathered again when next read. */
    keptChanged() {
      ranksStale = true;
    },
    /** The root cover, host pages, drawn cuts and requests through the shared rank encoder. */
    retainedRanks() {
      if (!ranksStale) return ranks.hold();
      ranksStale = false;
      ranks.begin();
      for (const url of bootstrapUrls) ranks.markRank(rankOf(url));
      for (const url of modifiedPages) ranks.markRank(rankOf(url));
      for (const view of views) {
        for (const rec of view.shown) markRecord(rec);
        for (const rec of view.requested) markRecord(rec);
      }
      return ranks.finish();
    },
    /** Gives a page's geometry back: one eviction per page, as the WebGPU page cache counts them,
     *  and none for a page that held nothing. */
    dropPage(url: string) {
      if (bootstrapUrls.has(url) || modifiedPages.has(url)) return;
      if (geometryStore.releasePage(url)) state.cacheEvictions++;
    },
  };
}
