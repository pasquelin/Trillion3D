import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuPageTracking } from '../row/pageTracking.ts';
import { structureIndex } from '../../page/selection/structure.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { ClusterRoot } from '../../page/selection/types.ts';
import { createPageParents } from './admission.ts';
import { createWebgpuResidentEnsurer } from './residentEnsurer.ts';
import { ensurerOptions, lruCache, pageOf } from './residentEnsurer.fixture.ts';
import { linkBundleDependencies } from '../../page/selection/bundleDependencies.ts';
import { RequestStamps, collectPendingUrls } from '../../page/selection/selection.ts';
import { createCutDelta } from '../cut/delta.ts';
import { createCutPending } from '../cut/pending.ts';

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
  const ensure = createWebgpuResidentEnsurer({ ...ensurerOptions(tracking, cache), ...options });
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

test('a page whose parent is outside the cut brings its bundle, then both load in order', async () => {
  const { pages, parentsOf } = placement();
  const [r, m, a] = pages;
  // Bundles: 0 holds the root, 1 the mid cluster, 2 the leaves; each lists what it follows.
  const streams = { pages: [[], [0], [0, 1]].map((dependencies) => ({ dependencies })) };
  const primitive = { pages: [0, 1, 2, 2].map((stream) => ({ stream })), streams };
  pages.forEach((page, index) => {
    page.streamUrl = `bundle-${[0, 1, 2, 2][index]}`;
    page.requestIndex = [0, 1, 2, 2][index];
    page.packedIndex = index;
    if (page !== r) page.array = undefined;
  });
  linkBundleDependencies(primitive as never, pages);
  const delta = createCutDelta(pages, []),
    pending = createCutPending(pages, delta);
  const requested = () => collectPendingUrls(pending.records, [], new RequestStamps(3));
  const arrive = (url: string, bytes: Uint32Array | undefined) =>
    pages.forEach(
      (page, id) => page.streamUrl === url && ((page.array = bytes), pending.touch(id)),
    );
  // Only the leaf is in the cut: its parent's bundle is requested with it, parents first.
  delta.apply([2]);
  pending.apply();
  assert.deepEqual(requested(), ['bundle-1', 'bundle-2']);
  // The leaf's bytes alone do not complete it: the parent is still asked for.
  arrive('bundle-2', new Uint32Array(1));
  assert.deepEqual(requested(), ['bundle-1']);
  arrive('bundle-1', new Uint32Array(1));
  assert.equal(pending.count, 0);
  // The parent's bytes leaving puts the leaf's request back.
  arrive('bundle-1', undefined);
  assert.deepEqual(requested(), ['bundle-1']);
  arrive('bundle-1', new Uint32Array(1));
  const { loads, want } = ensurerOver(8, pages, { parentsOf, hasBytes: (rec) => !!rec.array });
  await want(a);
  assert.deepEqual(loads, ['r', 'm', 'a'], 'the parent fetched outside the cut loads first');
  assert.equal(m.dependencies?.[0], r);
});

test('a page whose dependency does not fit is never admitted', async () => {
  const { pages, parentsOf } = placement();
  const [, , a] = pages;
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
  const { loads, want } = ensurerOver(8, pages, {
    parentsOf,
    lowerTiers: () => [{ pages: [b], has: () => true }],
  });
  await want();
  assert.deepEqual(loads, ['r', 'm', 'b']);
});
