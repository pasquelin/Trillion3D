// The page budget's search from one image to the next (`pageBudgetFrom`), and the slots a page
// takes when a resident ancestor or a fallback draws in its place (`tally.ts`).
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
} from '../../../../../bench/perf/browser/support/dagCut.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';

const { fine: FINE_ERROR, top: TOP_ERROR } = DAG_LEVEL_ERRORS;
const twoLevels = (fine: number, coarse: number, share: boolean) => [
  racine(dagLevels(fine, coarse, { share })),
];

/** The cut at one pixel, which selects the fine level (0.01 seen from nine units away is under a
 *  pixel, 0.02 over it), with the fallback that draws resident ancestors; `from` takes the budget
 *  search's path (`pageBudgetFrom`). */
function drawnInPlace(roots: ReturnType<typeof twoLevels>, budget: number, from?: number) {
  return selectVisiblePages(
    roots,
    cameraMoteur(camera()),
    { ...ask(1, budget), rootFallback: true, pageBudgetFrom: from },
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

test('an overflow only a fallback draws fails a pass of the budget search, not of the one-shot cut', () => {
  // Records naming no share take a slot per record drawn: the 60 coarse pages drawn in place of
  // the missing fine ones overflow 50 slots, and the search draws the cut coarser, at the top page.
  const cut = drawnInPlace(twoLevels(10, 60, false), 50, 0);
  assert.ok(cut.pixelError > 1, 'the cut is drawn coarser');
  assert.deepEqual(
    cut.shown.map((page) => page.lodError),
    [TOP_ERROR],
    'the budget holds',
  );
  assert.equal(cut.requiredSlots, null, 'the fallback that overflowed was not kept');
  assert.equal(cut.hostCutFits, false);
  // Without `pageBudgetFrom` (the exact engine), only a page the descent keeps fails a pass.
  const exact = drawnInPlace(twoLevels(10, 60, false), 50);
  assert.equal(exact.pixelError, 1, 'the one-shot cut keeps the host threshold');
  assert.equal(exact.shown.length, 60);
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
