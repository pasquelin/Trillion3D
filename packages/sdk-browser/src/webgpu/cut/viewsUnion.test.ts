// #268 (the follow-up of #412): the residency holds the union of the views' cuts, under the one
// page budget, and a single view publishes exactly what it published before views existed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuCutPublication } from './publication.ts';
import { keysOf, queueOf, rec, world } from '../residency/sets.fixture.ts';
import { createWebgpuRunState } from '../pages/state/run.ts';
import { createWebgpuGpuState } from '../pages/state/gpu.ts';
import { createWebgpuVisState } from '../pages/state/vis.ts';
import { createWebgpuView, createWebgpuViews, type WebgpuView } from '../pages/state/view.ts';
import { useWebgpuView } from '../pages/state/viewSwitch.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** Eight pages, levels 0 to 3 twice over. */
const eightPages = () => world(Array.from({ length: 8 }, (_, i) => rec(`p${i}`, i % 4)));

/** Eight pages published through one publication and real sets, on the runtime groups the view
 *  switch trades. */
function bench() {
  const scene = eightPages();
  const run = createWebgpuRunState(),
    gpu = createWebgpuGpuState([1, 1]),
    vis = createWebgpuVisState(),
    setup = { viewport: [1, 1] as [number, number] };
  const aheadOffers: number[][] = [];
  const ahead = {
    hostBytes: 0,
    offerIds: (ids: ArrayLike<number>) => aheadOffers.push(Array.from(ids)),
  };
  const capture = { capturing: false };
  const rt = {
    capture,
    run,
    gpu,
    vis,
    setup,
    views: createWebgpuViews({ run, gpu, vis, setup } as unknown as WebgpuPagesRuntime),
    layout: {
      packedPages: scene.packed,
      recordOf: (packed: number) => scene.packed[packed],
      gpuWanted: [],
      selectionRoots: [],
      rows: { watchTouched: () => {} },
    },
  } as unknown as WebgpuPagesRuntime;
  const publication = createWebgpuCutPublication(
    rt,
    scene.sets,
    scene.closure,
    { all: [ahead], ahead },
    () => false,
  );
  const { main } = rt.views,
    side = createWebgpuView(1, 1);
  /** `view` draws the pages `ids` name, as `../pages/render/cpu.ts` publishes a CPU cut. */
  const draw = (view: WebgpuView, ids: number[]) => {
    useWebgpuView(rt, view);
    // The CPU cut publishes packed ranks; `ids` already are the catalogue's ranks.
    publication.adoptCpuCut(ids, ids);
  };
  const keys = (ids: number[]) => new Set(ids.map((id) => scene.tracking.keyOf(scene.packed[id])));
  return { ...scene, publication, capture, main, side, draw, keys, aheadOffers };
}

test('a second view keeps its pages while the main view draws, all under the one budget', () => {
  const { sets, tracking, publication, main, side, draw, keys, budget } = bench();
  draw(main, [0, 1, 2, 3]);
  draw(side, [1, 4, 5, 6, 7]);
  draw(main, [0, 1]);
  assert.deepEqual(keysOf(tracking.keep), keys([0, 1, 4, 5, 6, 7]), 'the union is kept');
  assert.equal(sets.requestedCount, 6, 'a page both views draw is asked for once');
  assert.equal(budget(3), true, 'the union overruns the budget');
  assert.equal(tracking.wanted.count, 3, 'the budget is the one budget, never one per view');
  assert.deepEqual(keysOf(tracking.wanted), keys([7, 6, 1]), 'the coarsest pages of the union');
  publication.releaseView(side);
  budget(3);
  assert.deepEqual(keysOf(tracking.keep), keys([0, 1]), 'a view released lets its pages go');
  assert.deepEqual(keysOf(tracking.wanted), keys([0, 1]));
});

test('under budget pressure a capture keeps the detail pages it kept alone', () => {
  const { tracking, publication, capture, main, side, draw, keys, budget } = bench();
  /** The pages `ids` keep at `room` when their view is the only one, as before views existed. */
  const alone = (ids: number[], room: number) => {
    const only = eightPages();
    only.delta.apply(ids);
    only.cut();
    only.budget(room);
    return keysOf(only.tracking.wanted);
  };
  const kept = (ids: number[]) => [...keys(ids)].filter((key) => tracking.wanted.has(key));
  draw(main, [0, 1, 2, 3]);
  capture.capturing = true;
  draw(side, [4, 5, 6, 7]);
  budget(3);
  assert.equal(kept([4, 5, 6, 7]).length, 3, 'the capture keeps as many pages as alone');
  assert.deepEqual(keysOf(tracking.wanted), alone([4, 5, 6, 7], 3), 'the same pages');
  capture.capturing = false;
  publication.releaseView(side);
  draw(main, [0, 1, 2, 3]);
  budget(3);
  assert.deepEqual(keysOf(tracking.wanted), alone([0, 1, 2, 3], 3), 'the main view, as alone');
});

test('a persistent view and the main one rank the one union, whichever is drawn', () => {
  const { tracking, sets, main, side, draw, keys, budget } = bench();
  draw(main, [0, 1, 2, 3]);
  draw(side, [4, 5, 6, 7]);
  budget(3);
  const queue = keysOf(tracking.wanted),
    revision = sets.acceptedRevision;
  for (let frame = 0; frame < 3; frame++) {
    draw(main, [0, 1, 2, 3]);
    budget(3);
    draw(side, [4, 5, 6, 7]);
    budget(3);
  }
  assert.deepEqual(keysOf(tracking.wanted), queue, 'views drawn every frame never trade slots');
  assert.equal(sets.acceptedRevision, revision, 'the queue is never ranked to other pages');
  assert.deepEqual(queue, keys([7, 3, 2]), 'the coarsest pages of the union, as on develop');
});

test("another view's cut leaves the main view's pages ahead alone", () => {
  const { main, side, draw, aheadOffers } = bench();
  draw(main, [0]);
  const offers = aheadOffers.length;
  draw(side, [4]);
  assert.equal(aheadOffers.length, offers, 'the view ahead is the main view’s own');
});

test('one view asks, keeps and ranks what it did before views existed', () => {
  const { sets, tracking, main, draw, budget } = bench();
  // The contract before #268: the cut's records, one difference, the sets, the budget.
  const before = eightPages();
  const cuts = [[0, 1, 2, 3], [2, 3, 4, 5, 6], [], [1, 3, 5, 7], [7]];
  for (const ids of cuts) {
    draw(main, ids);
    before.delta.adoptRecords(
      ids.map((id) => before.packed[id]),
      (rec) => before.packed.indexOf(rec),
    );
    before.cut();
    before.sets.applyDrawn(before.delta);
    for (const room of [2, 64]) {
      budget(room);
      before.budget(room);
      assert.deepEqual(
        queueOf(tracking.wanted),
        queueOf(before.tracking.wanted),
        `cut ${ids}, room ${room}: the queue, in its order`,
      );
      assert.deepEqual(keysOf(tracking.keep), keysOf(before.tracking.keep));
      assert.equal(sets.requestedCount, before.sets.requestedCount);
    }
  }
});

test('XR suspends the main cut pins while eye views retain the shared budget, then main can publish again', () => {
  const { tracking, sets, publication, main, side, draw, keys, budget } = bench();
  draw(main, [0, 1, 2, 3]);
  draw(side, [1, 4, 5]);
  publication.setMainViewActive(false);
  budget(3);
  assert.deepEqual(keysOf(tracking.keep), keys([1, 4, 5]));
  assert.equal(sets.requestedCount, 3);
  assert.deepEqual(
    keysOf(tracking.wanted),
    keys([1, 4, 5]),
    'stale screen pins do not compete with eye detail',
  );
  publication.setMainViewActive(false);
  publication.releaseView(side);
  publication.setMainViewActive(true);
  draw(main, [6, 7]);
  budget(3);
  assert.deepEqual(keysOf(tracking.keep), keys([6, 7]));
  assert.equal(sets.requestedCount, 2);
});
