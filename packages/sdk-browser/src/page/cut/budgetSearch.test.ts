// The page budget's search from one image to the next (`pageBudgetFrom`), and the slots a page
// takes when a resident ancestor or a fallback draws in its place (`tally.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectVisiblePages } from '../selection/selection.ts';
import {
  dag,
  dagAsk as ask,
  dagCamera as camera,
  racine,
  type DagPage,
} from '../../../../../bench/perf/browser/support/dagCut.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';

/** Levels on one sphere: `fine` pages, missing, whose parent error is that of `coarse` pages,
 *  resident, under one resident top page. A cut at `FINE_ERROR` asks for the fine pages and draws
 *  the coarse ones in their place. */
const FINE_ERROR = 0.01,
  COARSE_ERROR = 0.02,
  TOP_ERROR = 0.08;
function twoLevels(fine: number, coarse: number, share: boolean) {
  const sphere = [0, 0, 0, 0.5],
    level = (count: number, error: number, parent: number | null, resident: boolean) =>
      Array.from({ length: count }, (_, i) => ({
        url: `${error}-${i}.bin`,
        level: Math.log2(error / FINE_ERROR),
        triangles: 1,
        min: [-0.5, -0.5, -0.5],
        max: [0.5, 0.5, 0.5],
        sphere,
        lodError: error,
        parentError: parent,
        parentSphere: parent === null ? null : sphere,
        group: null,
        source: null,
        array: resident ? new Uint32Array(3) : undefined,
        budgetShare: share ? { pass: 0, slots: 1 } : undefined,
      })) as DagPage[];
  return [
    racine([
      ...level(1, TOP_ERROR, null, true),
      ...level(coarse, COARSE_ERROR, TOP_ERROR, true),
      ...level(fine, FINE_ERROR, COARSE_ERROR, false),
    ]),
  ];
}

/** The cut at one pixel, which selects the fine level (0.01 seen from nine units away is under a
 *  pixel, 0.02 over it), with the fallback that draws resident ancestors. */
function drawnInPlace(roots: ReturnType<typeof twoLevels>, budget: number) {
  return selectVisiblePages(
    roots,
    cameraMoteur(camera()),
    { ...ask(1, budget), rootFallback: true },
    [],
  );
}

test('a missing page drawn by its resident ancestor takes one place: the fine cut is asked for', () => {
  // 150 slots, 60 coarse pages drawn, 100 fine pages asked for: the fine cut fits on its own.
  const cut = drawnInPlace(twoLevels(100, 60, true), 150);
  assert.equal(cut.wanted.length, 100, 'the fine cut is asked for');
  assert.ok(cut.wanted.every((page) => page.lodError === FINE_ERROR));
  assert.equal(cut.shown.length, 60, 'the coarse pages hold the place meanwhile');
  assert.equal(cut.requiredSlots, 100);
});

test('an overflow only a fallback draws fails the pass', () => {
  // Records naming no share take a slot per record drawn: the 60 coarse pages drawn in place of
  // the missing fine ones overflow 50 slots, and the cut is drawn coarser, at the top page.
  const cut = drawnInPlace(twoLevels(10, 60, false), 50);
  assert.ok(cut.pixelError > 1, 'the cut is drawn coarser');
  assert.deepEqual(
    cut.shown.map((page) => page.lodError),
    [TOP_ERROR],
    'the budget holds',
  );
  assert.equal(cut.requiredSlots, null, 'the fallback that overflowed was not kept');
});

test('the search goes on from the previous threshold, one step of √2 an image, and settles', () => {
  const pages = dag({ feuilles: 1024, seed: 5, residentes: 1 });
  const roots = [racine(pages)];
  const cam = camera();
  const image = (from: number, budget: number) =>
    selectVisiblePages(roots, cameraMoteur(cam), { ...ask(1, budget), pageBudgetFrom: from }, []);
  // A budget the host's threshold holds: from far above, one step finer an image, down to it.
  let cut = image(64, 2000),
    images = 1;
  assert.equal(cut.pixelError, 64 / Math.SQRT2, 'one step finer, not straight to the floor');
  assert.equal(cut.budgetSettled, false, 'a finer step is left to try');
  while (!cut.budgetSettled && images < 40) {
    cut = image(cut.pixelError, 2000);
    images++;
  }
  assert.equal(cut.pixelError, 1);
  assert.equal(cut.requiredSlots, cut.shown.length);
  // A smaller budget holds in the image that draws it: the search climbs by √2 in that image.
  const small = image(1, 100);
  assert.ok(small.shown.length <= 100 && small.pixelError > 1);
  assert.equal(small.budgetSettled, true);
  assert.equal(small.requiredSlots, null);
  // Once settled, the finer step does not fit: the threshold stays, to √2 of the finest that fits.
  const again = image(small.pixelError, 100);
  assert.equal(again.pixelError, small.pixelError);
  assert.equal(again.budgetSettled, true);
  assert.ok(image(small.pixelError / Math.SQRT2 + 1e-9, 0).shown.length > 100);
});
