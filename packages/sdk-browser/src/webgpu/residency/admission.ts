import type { PageRec } from '../../page/selection/selection.ts';
import type { createGpuPageCache } from '../../gpu/page/pages.ts';
import type { createWebgpuPageTracking } from '../row/pageTracking.ts';
import { pageAddress } from '../row/pageSlots.ts';

type PoolCache = Pick<ReturnType<typeof createGpuPageCache>, 'get' | 'load' | 'pin'>;
type Tracking = ReturnType<typeof createWebgpuPageTracking>;

/**
 * Install order, the one rule of every path that fills the pool: a page is loaded only after the
 * pages it depends on are resident, and loading it brings its missing dependencies first, each
 * after its own, up to the pinned root cover. The queue therefore walks one closed set, with no
 * special case: whatever the tier, a page never enters the pool before its parents.
 *
 * Two readers, one closure. The pool holds clusters, not bundles, so admission walks the cluster
 * parents (`createPageParents`, `../../residency/pageParents.ts`); the bytes come by bundle, so
 * the request reads the compiled bundle lists (`PageRec.dependencies`, `../cut/pending.ts`). The
 * cook refuses a bundle list that misses the bundle of a parent or is not closed, so the bundles of
 * every page walked here are requested and retained with the page. The group-mates the cut rule
 * needs are asked for by the cut itself (`../../page/cut/groupClosure.ts`), each admitted in its
 * own right: whole bundles are never loaded, their other clusters would spend pool slots nothing
 * draws.
 *
 * `admit` returns the number of pages it loaded, or -1 when a dependency has no bytes yet or was
 * reclaimed before the page could follow it: the page then waits for its requested bytes, drawn
 * through its resident ancestor. A full pool is not caught here: the load throws, and the caller stops.
 */
export function createPageAdmission(options: {
  getCache: () => PoolCache | undefined;
  tracking: Pick<Tracking, 'keyOf' | 'wanted' | 'markPinned'>;
  bootstrapKey: Uint8Array;
  signal?: AbortSignal;
  isLost: () => boolean;
  hasBytes: (rec: PageRec) => boolean;
  parentsOf: (rec: PageRec) => readonly PageRec[];
}) {
  const { getCache, tracking, bootstrapKey, signal, isLost, hasBytes, parentsOf } = options;
  const current = () => {
    const cache = getCache();
    if (isLost() || !cache) throw new Error('WEBGPU_LOST');
    return cache;
  };
  const holds = (rec: PageRec) => !!getCache()?.get(pageAddress(rec));
  /** One load, pinned when the image holds the page: the wanted set or the root cover. */
  const load = async (rec: PageRec) => {
    const address = pageAddress(rec);
    await current().load(address, signal);
    const key = tracking.keyOf(rec);
    if (tracking.wanted.has(key) || bootstrapKey[key]) {
      current().pin(address);
      tracking.markPinned(key);
    }
  };
  const admit = async (rec: PageRec): Promise<number> => {
    const parents = parentsOf(rec);
    let loaded = 0;
    for (const parent of parents) {
      if (holds(parent)) continue;
      if (!hasBytes(parent)) return -1;
      const more = await admit(parent);
      if (more < 0) return -1;
      loaded += more;
    }
    for (const parent of parents) if (!holds(parent)) return -1;
    await load(rec);
    return loaded + 1;
  };
  return admit;
}

/**
 * The reads an admission pass is about to wait for, started before it admits anything: each page of
 * `pages` that `admits` accepts and the pool does not hold, after the parents its admission would
 * bring, at most `limit` of them, under `signal`. The walk is `admit`'s and stops where `admit`
 * would give up (a parent without its bytes). The reads overlap on the network; the pass after them
 * is not touched — the same pages in the same order, each load joining the read under way.
 */
export function createAdmissionReads(options: {
  hasBytes: (rec: PageRec) => boolean;
  parentsOf: (rec: PageRec) => readonly PageRec[];
  prefetch: (rec: PageRec, signal: AbortSignal) => void;
}) {
  const { hasBytes, parentsOf, prefetch } = options;
  return (
    pages: readonly PageRec[],
    limit: number,
    admits: (rec: PageRec) => boolean,
    pool: Pick<PoolCache, 'get'>,
    signal: AbortSignal,
  ) => {
    const asked = new Set<string>();
    const walk = (rec: PageRec): boolean => {
      const address = pageAddress(rec);
      if (pool.get(address) || asked.has(address)) return true;
      if (!hasBytes(rec)) return false;
      for (const parent of parentsOf(rec)) if (!walk(parent)) return false;
      if (asked.size >= limit) return false;
      asked.add(address);
      prefetch(rec, signal);
      return true;
    };
    for (let i = 0; i < pages.length && asked.size < limit; i++)
      if (admits(pages[i])) walk(pages[i]);
  };
}
