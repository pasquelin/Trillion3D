// The WebGL2 path's views (`views.ts`, #1096): one record per view for what a camera owns, one
// switch that trades references, and the pool admitting the union of the views' requests under
// its one budget (`poolUnion.ts`), the residency pinning that union (`residency.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE } from './pool.fixture.ts';
import { mount } from './poolCut.fixture.ts';
import { createAutonomousResidency } from './residency.ts';
import { type HostCamera } from '../../camera/world.ts';
import { dag, dagCamera } from '../../../../../bench/perf/browser/support/dagCut.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { HostRetentionDelta } from '../../streaming/types.ts';

const urls = (list: readonly PageRec[]) => list.map((page) => page.url);
const retainedUrls = (delta: HostRetentionDelta) =>
  Array.from(delta.held.subarray(0, delta.heldCount), (rank) => delta.urls[rank]);
const formerUrls = (
  roots: Set<string>,
  modified: Set<string>,
  views: readonly { shown: readonly PageRec[]; requested: readonly PageRec[] }[],
) =>
  new Set([
    ...roots,
    ...modified,
    ...views.flatMap((view) => [...urls(view.shown), ...urls(view.requested)]),
  ]);

/** A camera `height` units above `(x, y)` of the DAG's plane, looking straight down at it. */
const above = (x: number, y: number, height: number) =>
  dagCamera(height, x, y) as unknown as HostCamera;

test('the views ask for their union under the one budget, a shared page charged once', () => {
  const pages = dag({ feuilles: 256, seed: 11, residentes: 0 }),
    rootUrls = new Set(pages.filter((page) => page.parentError == null).map((page) => page.url));
  const m = mount(1000 * PAGE, { pages }),
    { views } = m,
    side = views.create(1280, 720);
  const cameras = new Map([
    [views.main, above(-2, -2, 7)],
    [side, above(2, 2, 7)],
  ]);
  /** Each view draws `rounds` images in turn, from its own camera. */
  const alternate = (rounds: number, each?: () => void) => {
    for (let round = 0; round < rounds; round++)
      for (const view of [side, views.main]) {
        views.use(view);
        m.place(cameras.get(view)!);
        m.image(1);
        each?.();
      }
  };
  /** The slots the views' requests charge together: the root cover, then each page once. */
  const union = () => {
    const asked = new Set(views.all.flatMap((view) => urls(view.requested)));
    return rootUrls.size + [...asked].filter((url) => !rootUrls.has(url)).length;
  };
  alternate(6);
  const alone = Math.max(...views.all.map((view) => urls(view.requested).length)),
    together = union();
  assert.ok(together > alone + 4, `the views ask for different pages: ${alone} of ${together}`);
  m.pool.resize((alone + Math.floor((together - alone) / 2)) * PAGE);
  const { slots } = m.pool.held;
  assert.ok(slots > alone && slots < together, `${slots} slots hold either view, not both`);
  alternate(6, () => assert.ok(union() <= slots, `${union()} slots asked of ${slots}`));
  for (const view of views.all)
    assert.ok(
      view.requested.some((page) => !rootUrls.has(page.url)),
      'no view is starved',
    );
  // The streamer pins the union, and a released view's pages leave it.
  views.use(side);
  m.place(cameras.get(side)!);
  m.image(1);
  const residency = createAutonomousResidency({
    ...{ bootstrapUrls: rootUrls, modifiedPages: new Set<string>() },
    ...{ views: views.all, geometryStore: {} as never },
  });
  const mainKeeps = new Set([...urls(views.main.shown), ...urls(views.main.requested)]),
    sideOnly = urls(side.requested).filter((url) => !mainKeeps.has(url));
  assert.ok(
    sideOnly.length > 0 &&
      sideOnly.every((url) => retainedUrls(residency.retainedRanks()).includes(url)),
  );
  views.release(side);
  residency.keptChanged();
  assert.ok(
    sideOnly.every((url) => !retainedUrls(residency.retainedRanks()).includes(url)),
    'its pages leave',
  );
});

test('WebGL rank pins match the former URL pins at every camera step', () => {
  const pages = dag({ feuilles: 256, seed: 11, residentes: 0 });
  const m = mount(1000 * PAGE, { pages });
  const rootUrls = new Set(
    pages.filter((page) => page.parentError == null).map((page) => page.url),
  );
  const modifiedPages = new Set<string>();
  const residency = createAutonomousResidency({
    bootstrapUrls: rootUrls,
    modifiedPages,
    views: m.views.all,
    geometryStore: {} as never,
  });
  const retained = new Set<string>(),
    cuts = new Set<string>();
  for (const distance of [20, 12, 6, 3, 1, 5, 14, 2]) {
    m.place(distance);
    m.image(1);
    residency.keptChanged();
    const delta = residency.retainedRanks();
    for (let i = 0; i < delta.exitedCount; i++) retained.delete(delta.urls[delta.exited[i]]);
    for (let i = 0; i < delta.enteredCount; i++) retained.add(delta.urls[delta.entered[i]]);
    cuts.add([...retained].sort().join(','));
    assert.deepEqual(
      retained,
      formerUrls(rootUrls, modifiedPages, m.views.all),
      `camera distance ${distance}`,
    );
    const held = residency.retainedRanks();
    assert.equal(held.enteredCount + held.exitedCount, 0, 'unchanged frame has no delta');
  }
  assert.ok(cuts.size > 1, 'camera path changes the retained cut');
  modifiedPages.add('mounted-later.bin');
  residency.keptChanged();
  const mounted = residency.retainedRanks();
  assert.equal(mounted.urls[mounted.entered[mounted.enteredCount - 1]], 'mounted-later.bin');
  assert.deepEqual(
    new Set([...retained, 'mounted-later.bin']),
    formerUrls(rootUrls, modifiedPages, m.views.all),
  );
});
