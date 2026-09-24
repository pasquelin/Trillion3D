import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuPageTracking } from '../row/pageTracking.ts';
import { structureIndex } from '../../page/selection/structure.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { ClusterRoot } from '../../page/selection/types.ts';
import { createPageParents } from './admission.ts';
import { createWebgpuResidentEnsurer } from './residentEnsurer.ts';
import { lruCache, pageOf } from './residentEnsurer.fixture.ts';

/** One placement: the root `r`, the mid cluster `m` replacing the leaves `a` and `b`, and `r`
 *  replacing `m`. Group 0 turns `m` into `r`, group 1 turns `a` and `b` into `m`. */
function placement() {
  const pages = ['r', 'm', 'a', 'b'].map(pageOf);
  const groups = [0, 1, 1].map((group, i) => [pages[i + 1], group] as const);
  for (const [page, group] of groups) page.group = group;
  for (const page of pages) page.placementIndex = 0;
  const band = { error: 1, sphere: [0, 0, 0, 1] };
  const structure = structureIndex(
    {
      version: 1,
      roots: [0],
      groups: [
        { level: 1, ...band, children: [1], outputs: [0] },
        { level: 0, ...band, children: [2, 3], outputs: [1] },
      ],
    },
    pages.length,
  );
  const root = { world: { elements: [] }, pages, structure } as unknown as ClusterRoot<PageRec>;
  return { pages, parentsOf: createPageParents([root]) };
}

/** A pool of `slots` that journals every load, and an ensurer over it. */
function ensurerOver(
  slots: number,
  pages: PageRec[],
  options: Partial<Parameters<typeof createWebgpuResidentEnsurer>[0]> = {},
) {
  const tracking = createWebgpuPageTracking(pages);
  const cache = lruCache(slots),
    loads: string[] = [];
  const load = cache.load;
  cache.load = async (url: string) => (loads.push(url), load(url));
  const ensure = createWebgpuResidentEnsurer({
    getCache: () => cache as never,
    tracking,
    bootstrapKey: new Uint8Array(tracking.keyCount),
    hasBytes: () => true,
    parentsOf: () => [],
    isLost: () => false,
    traceEnabled: false,
    traceDiagnostic: () => {},
    shadowPages: () => [],
    ...options,
  });
  const want = (...wanted: PageRec[]) => {
    for (const page of wanted) tracking.wanted.add(tracking.keyOf(page), page);
    return ensure(wanted, 1, 1);
  };
  return { cache, loads, want };
}

test('a requested page brings its missing dependencies, each loaded before what depends on it', async () => {
  const { pages, parentsOf } = placement();
  const [, , a, b] = pages;
  const { cache, loads, want } = ensurerOver(8, pages, { parentsOf });
  await want(a, b);
  assert.deepEqual(loads, ['r', 'm', 'a', 'b'], 'the closure first, then the pages, once each');
  assert.deepEqual([...cache.pins].sort(), ['a', 'b'], 'only what the image holds is pinned');
});

test('a page whose dependency cannot be resident is never admitted', async () => {
  const { pages, parentsOf } = placement();
  const [, m, a] = pages;
  // The middle cluster has no bytes yet: the leaf waits, drawn through its resident ancestor.
  const early = ensurerOver(8, pages, { parentsOf, hasBytes: (rec) => rec !== m });
  await early.want(a);
  assert.deepEqual(early.loads, [], 'neither the leaf nor anything above the missing page');
  // A pool full of pinned pages refuses the root: nothing below it enters either.
  const full = ensurerOver(1, pages, { parentsOf });
  await full.cache.load('held');
  full.cache.pin('held');
  await full.want(a);
  assert.equal(full.cache.get('a'), undefined);
  assert.equal(full.cache.get('m'), undefined);
});

test('a shadow caster enters the pool after its dependencies too', async () => {
  const { pages, parentsOf } = placement();
  const [, , , b] = pages;
  const { loads, want } = ensurerOver(8, pages, { parentsOf, shadowPages: () => [b] });
  await want();
  assert.deepEqual(loads, ['r', 'm', 'b']);
});
