// The page budget's search from one image to the next (`BudgetSearch`, the WebGL2 pool's
// `poolSearch.ts`), and the places a page takes when a resident ancestor or a fallback draws in
// its place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectVisiblePages } from '../selection/selection.ts';
import {
  DAG_LEVEL_ERRORS,
  dag,
  dagAsk as ask,
  dagLevels,
  dagCamera as camera,
  racine,
  type DagPage,
} from '../../../../../bench/perf/browser/support/dagCut.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';
import { createPoolSearch } from '../../backend/autonomous/poolSearch.ts';

const { fine: FINE_ERROR, top: TOP_ERROR } = DAG_LEVEL_ERRORS;

/** Images of `pages` under the pool's search: one place a page, `held` taken beforehand; `budget`
 *  may change between images. */
function searched(pages: DagPage[], budget: number, { held = 0, rootError = 0 } = {}) {
  const shares = new Map(pages.map((page) => [page.url, { pass: 0, slots: 1 }]));
  const pool = createPoolSearch({
    budget: () => session.budget,
    held: () => held,
    shares,
    rootError,
    coverRevision: () => 0,
    viewRevision: () => 0,
  });
  const roots = [racine(pages)],
    cam = camera();
  const session = {
    budget,
    pool,
    image: (rootFallback = false) =>
      selectVisiblePages(
        roots,
        cameraMoteur(cam),
        { ...ask(1, 0), rootFallback, slotsOf: pool.slotsOf, search: pool.search },
        [],
      ),
  };
  return session;
}

test('a missing page drawn by its resident ancestor takes one place: the fine cut is asked for', () => {
  // 150 places, 60 coarse pages drawn, 100 fine pages asked for: the fine cut fits on its own.
  const { image, pool } = searched(dagLevels(100, 60), 150);
  const cut = image(true);
  assert.equal(cut.wanted.length, 100, 'the fine cut is asked for');
  assert.ok(cut.wanted.every((page) => page.lodError === FINE_ERROR));
  assert.equal(cut.shown.length, 60, 'the coarse pages hold the place meanwhile');
  assert.equal(pool.requiredSlots, 100);
  assert.equal(pool.verdict, 'fits');
});

test('a page asked for by several records is charged once, above what the pool holds', () => {
  // Two copies of one tree, as rows place it: both name the same pages.
  const pages = dag({ feuilles: 64, seed: 7, residentes: 0.5 });
  const twin = pages.map((page) => ({ ...page }));
  const free = selectVisiblePages([racine(pages)], cameraMoteur(camera()), ask(1, 0), []);
  const asked = free.wanted.length;
  const both = searched([...pages, ...twin], asked);
  const exact = both.image();
  assert.equal(exact.pixelError, 1);
  assert.equal(both.pool.requiredSlots, asked, 'the twin records charge nothing');
  // Two places held beforehand leave room for two pages fewer: the cut draws coarser, and what the
  // host's threshold would need is not known from a pass stopped at its first overflow.
  const held = searched([...pages, ...twin], asked, { held: 2 });
  assert.ok(held.image().pixelError > 1);
  assert.equal(held.pool.requiredSlots, null);
  assert.equal(held.pool.verdict, 'over');
});

test('an overflow only a fallback draws fails a pass: one rule, strict everywhere', () => {
  // Without a cost, each record drawn takes a place: the 60 coarse pages drawn in place of the
  // missing fine ones overflow 50, and the one-shot cut draws coarser, at the top page.
  const cut = selectVisiblePages(
    [racine(dagLevels(10, 60))],
    cameraMoteur(camera()),
    { ...ask(1, 50), rootFallback: true },
    [],
  );
  assert.ok(cut.pixelError > 1, 'the cut is drawn coarser');
  assert.deepEqual(
    cut.shown.map((page) => page.lodError),
    [TOP_ERROR],
    'the budget holds',
  );
});

test('the search goes on from the previous threshold, one step of √2 an image, and settles', () => {
  const session = searched(dag({ feuilles: 1024, seed: 5, residentes: 1 }), 100);
  // A smaller budget holds in the image that draws it: the search climbs by √2 in that image.
  const small = session.image();
  assert.ok(small.shown.length <= 100 && small.pixelError > 1);
  assert.equal(session.pool.settling, true, 'the finer step is still to try');
  // The finer step does not fit: the threshold stays, to √2 of the finest that fits.
  const again = session.image();
  assert.equal(again.pixelError, small.pixelError);
  assert.equal(session.pool.settling, false);
  assert.equal(session.image().pixelError, small.pixelError, 'one pass, the same threshold');
  // A budget the host's threshold holds: one step finer an image, down to it.
  session.budget = 2000;
  let cut = session.image(),
    images = 1;
  assert.equal(cut.pixelError, small.pixelError / Math.SQRT2, 'one step finer, not to the floor');
  while (session.pool.settling && images < 40) {
    cut = session.image();
    images++;
  }
  assert.equal(cut.pixelError, 1);
  assert.equal(session.pool.pixelError, 0);
  assert.equal(session.pool.requiredSlots, cut.shown.length);
});

test('the search never climbs past the root error seen at the near plane, from one image to the next', () => {
  // No root: every page has a parent a coarser threshold would draw, and a budget below what the
  // pool holds beforehand overflows at every threshold.
  const pages = dag({ feuilles: 64, seed: 3 }).filter((page) => page.parentError !== null);
  const rootError = 0.02;
  const { image, pool } = searched(pages, 1, { held: 2, rootError });
  const cam = camera();
  const focal = 360 / Math.tan(Math.PI / 6),
    ceiling = (rootError * focal) / cam.near;
  for (let frame = 0; frame < 4; frame++) {
    const cut = image();
    assert.ok(Math.abs(cut.pixelError / ceiling - 1) < 1e-9, `${cut.pixelError} for ${ceiling}`);
    assert.equal(pool.rootCover, true, 'drawn at the ceiling, without the budget');
    assert.equal(pool.settling, false);
  }
});
