// Both triangle sums are kept at retain time, no longer swept after the cut. They
// must stay, term for term and in the same order, those of the returned arrays — including
// when a fallback shortens `shown` then fills it again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectClusterPages, selectVisiblePages, type PageRec } from './selection.ts';
import { dagFixture, wideCamera } from './dag.fixture.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';

/** The sum the sweeps from before this batch computed: left to right, without reassociation. */
function sum(pages: readonly PageRec[]) {
  let total = 0;
  for (let i = 0; i < pages.length; i++) total += pages[i].triangles;
  return total;
}

test('returned triangle sums are those of the returned arrays, fallback included', () => {
  const fixture = dagFixture();
  const { roots, allPages } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const cam = wideCamera();
  // Every resident subset: the requested cut, the one that can be shown, forced-group
  // fallbacks and the emergency cover all go through this product.
  let vus = 0,
    replis = 0;
  for (let mask = 0; mask < 1 << allPages.length; mask += 7)
    for (const pixelError of [0, 0.5, 4])
      for (const rootFallback of [false, true]) {
        const wanted: PageRec[] = [];
        const result = selectVisiblePages(roots, cameraMoteur(cam), {
          pixelError,
          viewport: [1280, 720],
          holdResident: true,
          rootFallback,
          isResident: (page) => ((mask >> allPages.indexOf(page)) & 1) === 1,
          wanted,
        });
        vus++;
        if (result.shown.length !== result.wanted.length) replis++;
        assert.ok(
          Object.is(result.displayedTriangles, sum(result.shown)),
          `displayed triangles, mask ${mask}, threshold ${pixelError}`,
        );
        assert.ok(
          Object.is(
            result.selectedTriangles,
            result.wanted.length ? sum(result.wanted) : sum(result.shown),
          ),
          `requested triangles, mask ${mask}, threshold ${pixelError}`,
        );
      }
  assert.ok(vus > 100, `only ${vus} cuts`);
  assert.ok(replis > 0, 'no cut where `shown` and `wanted` diverge');
});

test('the page budget does not skew the sums of the kept pass', () => {
  const fixture = dagFixture();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const cam = wideCamera();
  for (const pageBudget of [1, 2, 3, 5, 8]) {
    const wanted: PageRec[] = [];
    const result = selectVisiblePages(roots, cameraMoteur(cam), {
      pixelError: 0,
      viewport: [1280, 720],
      holdResident: true,
      pageBudget,
      wanted,
    });
    assert.ok(Object.is(result.displayedTriangles, sum(result.shown)), `budget ${pageBudget}`);
    assert.ok(
      Object.is(
        result.selectedTriangles,
        result.wanted.length ? sum(result.wanted) : sum(result.shown),
      ),
      `budget ${pageBudget}, requested`,
    );
  }
});
