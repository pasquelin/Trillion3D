import type { PageRec } from '../../page/selection/selection.ts';
import type { ClusterRoot } from '../../page/selection/types.ts';
import type { createGpuPageCache } from '../../gpu/page/pages.ts';
import type { createWebgpuPageTracking } from '../row/pageTracking.ts';
import { pageAddress } from '../row/pageSlots.ts';

type PoolCache = Pick<ReturnType<typeof createGpuPageCache>, 'get' | 'load' | 'pin'>;
type Tracking = ReturnType<typeof createWebgpuPageTracking>;

const NONE: readonly PageRec[] = [];

/**
 * The pages a cluster depends on: the clusters of the group that replaces it, read from the
 * compiled group links of its own placement (`structure.outputs`). A root depends on nothing.
 * `roots` are the selection roots, indexed by the `placementIndex` the layout posts on each page.
 */
export function createPageParents(roots: readonly ClusterRoot<PageRec>[]) {
  return (rec: PageRec): readonly PageRec[] => {
    const root = rec.placementIndex === undefined ? undefined : roots[rec.placementIndex],
      structure = root?.structure,
      group = rec.group;
    if (!root || !structure || group == null || group < 0 || group >= structure.groupCount)
      return NONE;
    const { outputOffsets, outputs } = structure;
    const parents: PageRec[] = [];
    for (let i = outputOffsets[group]; i < outputOffsets[group + 1]; i++)
      parents.push(root.pages[outputs[i]]);
    return parents;
  };
}

/**
 * Install order, the one rule of every path that fills the pool: a page is loaded only after the
 * pages it depends on are resident, and loading it brings its missing dependencies first, each
 * after its own, up to the pinned root cover. The queue therefore walks one closed set, with no
 * special case: whatever the tier, a page never enters the pool before its parents.
 *
 * `admit` returns the number of pages it loaded, or -1 when a dependency has no bytes yet or was
 * reclaimed before the page could follow it: the page then waits for a later pass, drawn through
 * its resident ancestor. A full pool is not caught here: the load throws, and the caller stops.
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
