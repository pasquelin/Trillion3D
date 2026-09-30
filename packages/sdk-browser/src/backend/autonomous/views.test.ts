// The WebGL2 path's views (`views.ts`, #1096): one record per view for what a camera owns, one
// switch that trades references, and the pool admitting the union of the views' requests under
// its one budget (`poolUnion.ts`), the residency pinning that union (`residency.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE } from './pool.fixture.ts';
import { mount } from './poolCut.fixture.ts';
import { createWebglViews, type WebglView } from './views.ts';
import { VIEW_KEYS as KEYS } from './viewKeys.ts';
import { createAutonomousResidency } from './residency.ts';
import { createEngineCamera, type HostCamera } from '../../camera/world.ts';
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
const cutOf = (view: WebglView) => ({
  shown: urls(view.shown),
  desired: urls(view.desired),
  requested: urls(view.requested),
});
/** A camera `height` units above `(x, y)` of the DAG's plane, looking straight down at it. */
const above = (x: number, y: number, height: number) =>
  dagCamera(height, x, y) as unknown as HostCamera;

test('a view drawn aside cuts into its own lists, and every reader reads the main view after', () => {
  const m = mount(1000 * PAGE);
  for (let i = 0; i < 8; i++) m.image(1);
  const { views } = m,
    { main, live } = views,
    before = cutOf(main);
  assert.ok(before.shown.length > 1, 'the main view drew a cut');
  views.captureAside({ width: 64, height: 32 }, () => {
    const aside = views.active;
    assert.notEqual(aside, main);
    m.place(above(2, 2, 7));
    m.image(1);
    for (const key of KEYS) assert.equal(live[key], aside[key], `${key} is the drawn view's`);
    assert.deepEqual(live.viewport, [64, 32], "the cut reads the view's own size");
    assert.notDeepEqual(urls(aside.desired), before.desired, 'the view aside cut its own');
    assert.deepEqual(cutOf(main), before, "the main view's cut is untouched meanwhile");
  });
  for (const key of KEYS) assert.equal(live[key], main[key], `${key} is the main view's again`);
  assert.equal(views.active, main);
  assert.deepEqual(views.all, [main], 'the view aside is released');
  assert.equal(views.others.length, 0);
  assert.deepEqual(cutOf(main), before);
  m.place(9);
  m.image(1);
  assert.deepEqual(cutOf(main), before, 'the main view draws on as if nothing was drawn aside');
});

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

test('one view: the switch never runs, and the pins and the queue are its own lists', () => {
  let replaced = 0,
    moved = 0;
  const gate = { cam: createEngineCamera(), viewReplaced: () => void replaced++ },
    views = createWebglViews([8, 8], gate, () => void moved++),
    { main, live } = views,
    cam = gate.cam;
  views.use(main);
  views.release(main);
  assert.equal(replaced + moved, 0, 'nothing ran');
  assert.equal(gate.cam, cam);
  assert.deepEqual(views.all, [main]);
  assert.equal(views.others.length, 0, 'the pool and the residency see no other view');
  for (const key of KEYS) assert.equal(live[key], main[key]);
  // Switched and back: the gate's camera and the live group follow, the host's size stays.
  const side = views.create(4, 2);
  views.use(side);
  assert.equal(gate.cam, side.cam);
  assert.deepEqual(views.others, [main]);
  views.release(side);
  assert.equal(gate.cam, cam);
  assert.deepEqual(live.viewport, [8, 8]);
  assert.equal(replaced, 2, 'each switch replaced the view');
  assert.equal(views.others.length, 0);
  // With one view, the pins and the queue are what the image keeps and asks for, as before views.
  const page = (url: string, array?: Uint32Array) => ({ url, array }) as PageRec;
  live.shown.push(page('a'), page('b', new Uint32Array(3)));
  live.requested.push(page('c'), page('b', new Uint32Array(3)), page('d'));
  const residency = createAutonomousResidency({
    ...{ bootstrapUrls: new Set(['r']), modifiedPages: new Set(['m']) },
    ...{ views: views.all, geometryStore: {} as never },
  });
  assert.deepEqual(residency.pendingUrls(), ['c', 'd']);
  assert.deepEqual(retainedUrls(residency.retainedRanks()), ['r', 'm', 'a', 'b', 'c', 'd']);
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
