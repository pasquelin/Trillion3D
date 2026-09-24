// C5: a cut pass that exceeds the page budget stops at the overflowing page
// (`cut.ts`) instead of taking each retry to the end before measuring it.
// The reference is the old `sweep()`: a complete retry, replayed here by calling
// selection without a budget (`pageBudget` omitted disables the `over` flag) and
// checking length ourselves, exactly what the loop did before lot C. The returned
// cut — shown and requested pages in order, counters, final threshold — must be
// strictly identical.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createSelectionResult, selectVisiblePages } from '../selection/selection.ts';
import { dag, racine, type DagPage } from '../../../../../bench/perf/browser/support/dagCut.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';

function camera() {
  const cam = G.perspectiveCamera(60, 16 / 9, 0.1, 200);
  cam.position.set(0, 0, 9);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

function ask(pixelError: number, pageBudget: number) {
  return {
    pixelError,
    viewport: [1280, 720] as [number, number],
    holdResident: true,
    pageBudget,
    wanted: [] as DagPage[],
    result: createSelectionResult<DagPage>(),
  };
}

/** `cut.ts` before lot C: each retry takes its descent to the end, the
 *  result length alone decides whether it is redone at double the threshold. */
function relanceComplete(
  roots: ReturnType<typeof racine>[],
  cam: G.GraphCamera,
  pixelError0: number,
  budget: number,
) {
  let pixelError = pixelError0;
  let result = selectVisiblePages(roots, cameraMoteur(cam), ask(pixelError, 0), []);
  for (let attempt = 0; budget && result.shown.length > budget && attempt < 16; attempt++) {
    pixelError = pixelError > 0 ? pixelError * 2 : 1;
    result = selectVisiblePages(roots, cameraMoteur(cam), ask(pixelError, 0), []);
  }
  return result;
}

function assertSameCut(
  neuf: ReturnType<typeof relanceComplete>,
  ancien: ReturnType<typeof relanceComplete>,
  message: string,
) {
  assert.deepEqual(
    neuf.shown.map((rec) => rec.url),
    ancien.shown.map((rec) => rec.url),
    `${message}: shown pages`,
  );
  assert.deepEqual(
    neuf.wanted.map((rec) => rec.url),
    ancien.wanted.map((rec) => rec.url),
    `${message}: requested pages`,
  );
  assert.equal(neuf.frustumRejected, ancien.frustumRejected, `${message}: frustumRejected`);
  assert.equal(neuf.nodesTested, ancien.nodesTested, `${message}: nodesTested`);
  assert.equal(neuf.lodLevel, ancien.lodLevel, `${message}: lodLevel`);
  assert.equal(neuf.complete, ancien.complete, `${message}: complete`);
  assert.ok(Object.is(neuf.pixelError, ancien.pixelError), `${message}: final threshold`);
}

test('a first pass overflowed by a single page converges on the same cut as the old retry', () => {
  const pages = dag({ feuilles: 1024, seed: 5, residentes: 1 });
  const roots = [racine(pages)];
  const cam = camera();
  // First pass (threshold 50): 18 pages for a budget of 17, over by a single page.
  const neuf = selectVisiblePages(roots, cameraMoteur(cam), ask(50, 17), []);
  const ancien = relanceComplete(roots, cam, 50, 17);
  assertSameCut(neuf, ancien, 'overflow of 1');
});

test('a first pass overflowed by an order of magnitude (10×) converges on the same cut', () => {
  const pages = dag({ feuilles: 1024, seed: 5, residentes: 1 });
  const roots = [racine(pages)];
  const cam = camera();
  // First pass (threshold 1): 1024 pages for a budget of 100, over by a little more than 10×.
  const neuf = selectVisiblePages(roots, cameraMoteur(cam), ask(1, 100), []);
  const ancien = relanceComplete(roots, cam, 1, 100);
  assertSameCut(neuf, ancien, 'overflow of 10×');
});

test('a budget held on the first try triggers no retry, on either side', () => {
  const pages = dag({ feuilles: 64, seed: 7, residentes: 1 });
  const roots = [racine(pages)];
  const cam = camera();
  const neuf = selectVisiblePages(roots, cameraMoteur(cam), ask(1, 1000), []);
  const ancien = relanceComplete(roots, cam, 1, 1000);
  assertSameCut(neuf, ancien, 'budget held');
  assert.equal(neuf.pixelError, 1, 'no doubling of the threshold');
});

test('a budget even the coarsest threshold cannot hold remakes the whole cut', () => {
  // Two disjoint roots: each converges toward a single coarsest cluster, so the
  // reachable minimum is 2 pages. A budget of 1 therefore overflows at every threshold, through the last.
  const roots = [0, 1].map((i) => racine(dag({ feuilles: 16, seed: 5 + i, residentes: 1 })));
  const cam = camera();
  const neuf = selectVisiblePages(roots, cameraMoteur(cam), ask(1, 1), []);
  const ancien = relanceComplete(roots, cam, 1, 1);
  assertSameCut(neuf, ancien, 'never satisfiable');
  assert.equal(neuf.shown.length, 2, 'incompressible minimum of the two roots');
  assert.equal(
    neuf.pixelError,
    65536,
    'sixteen doublings then the whole cut at the same threshold',
  );
});
