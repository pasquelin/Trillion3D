// The WebGL2 image under its geometry pool (`imageCut.ts`, `pool.ts`, `requests.ts`): the cut is
// drawn at the host's threshold whatever the budget, the pool bounds what the image asks for, and
// the cut rule draws the nearest resident ancestor of what the pool does not hold (#486).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE } from './pool.fixture.ts';
import { mount } from './poolCut.fixture.ts';
import { coverFault, ruleDag } from '../../page/cut/cutRule.fixture.ts';
import * as THREE from 'three';
import { dagCamera, type DagPage } from '../../../../../bench/perf/browser/support/dagCut.ts';
import type { HostCamera } from '../../camera/world.ts';

test('a smaller budget bounds what the image asks for and holds, never its threshold', () => {
  const { pool, state, diagnostics, image, drawn, wanted } = mount(1000 * PAGE);
  for (let frame = 0; frame < 12; frame++) image(1);
  const fine = drawn(),
    asked = wanted();
  assert.ok(state.allocationBytes > 40 * PAGE, `a fine cut to shrink: ${fine} pages`);
  assert.equal(pool.coverageBudgetLimited, false, 'a cut the budget did not limit');
  pool.resize(20 * PAGE);
  // Every image, the first to see the smaller budget included, releases what it no longer asks
  // for before its cut draws their ancestors.
  for (let frame = 0; frame < 12; frame++) {
    const most = image(1);
    assert.ok(most <= 20 * PAGE, `image ${frame}: ${most / PAGE} pages for 20 slots`);
    assert.equal(wanted(), asked, `image ${frame}: the cut is still the host's`);
    assert.equal(pool.coverageBudgetLimited, true, 'the verdict moves in the image that asked');
  }
  assert.ok(drawn() < fine, 'the pages the pool does not hold are drawn by their ancestors');
  assert.equal(
    diagnostics.filter(({ phase }) => phase === 'coverage-budget').length,
    0,
    'the verdict waits for the flush',
  );
  pool.flush();
  pool.flush();
  const published = diagnostics.filter(({ phase }) => phase === 'coverage-budget');
  assert.equal(published.length, 1, 'the verdict is published once, when it changes');
  assert.equal(published[0].context?.limited, true);
  assert.equal(published[0].context?.pixelError, 1, "the host's threshold");
  assert.ok((published[0].context?.requiredSlots as number) > 20, 'what the image asked, counted');
  // A larger budget brings the detail back as the pages arrive.
  pool.resize(400 * PAGE);
  for (let frame = 0; frame < 12; frame++) image(1);
  assert.ok(state.allocationBytes <= 400 * PAGE);
  assert.equal(pool.coverageBudgetLimited, false);
  assert.equal(drawn(), fine, 'the same cut as before the budget changed');
  pool.flush();
  const back = diagnostics.filter(({ phase }) => phase === 'coverage-budget');
  assert.equal(back.length, 2);
  assert.equal(back[1].context?.limited, false);
});

/** Down the strip from its near end, as the cut rule's tests see it: every leaf in view. */
function wholeStrip() {
  const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 4000);
  cam.position.set(-6, 4, 0);
  cam.lookAt(128, 0, 0);
  cam.updateMatrixWorld();
  return cam as unknown as HostCamera;
}

/** The rule DAG as the WebGL2 path collects it — one primitive, its group links, only its roots
 *  resident — under a pool of `budgetPages` pages. */
function strip(budgetPages: number, camera: HostCamera) {
  const dag = ruleDag(256);
  const pages = dag.pages.map((page) => ({ ...page, array: undefined })) as unknown as DagPage[];
  const mounted = mount(budgetPages * PAGE, { pages, structures: [dag.structure], camera });
  const index = new Map(pages.map((page, i) => [page, i]));
  const drawnIds = () => mounted.cut().shown.map((page) => index.get(page as DagPage)!);
  return { ...mounted, dag, pages, drawnIds };
}

test('group-mates past the frustum are asked for: the image converges to the cut it wants', () => {
  // Nine units above the strip's start: the frustum cuts the strip, and the groups across it.
  const { image, cut, frame, requested, pages } = strip(1000, dagCamera(9));
  for (let i = 0; i < 16; i++) image(0.25);
  const { shown, wanted } = cut();
  assert.ok(wanted.length > 4, `${wanted.length} pages wanted`);
  assert.equal(frame.stand, 0, 'no ancestor stands in for a wanted page any more');
  assert.deepEqual(new Set(shown), new Set(wanted), 'the cut draws what it wants');
  const asked = new Set(requested.map((page) => page.url));
  assert.ok(
    pages.some((page) => asked.has(page.url) && !wanted.includes(page as never)),
    'group-mates the view does not keep are asked for with the pages it wants',
  );
});

test('a pool at the root cover plus a tenth draws every leaf once, and never a hole', () => {
  const { image, dag, drawnIds } = strip(Math.ceil(dag0Roots() * 1.1), wholeStrip());
  for (let i = 0; i < 24; i++) {
    image(0.25, 3);
    assert.equal(coverFault(dag, drawnIds()), -1, `image ${i}: a leaf not covered exactly once`);
  }
});

// #490: the WebGL2 image publishes its holes from the cut it takes. A missing fine page is drawn
// by its ancestor, no hole; a missing root-cover page has nothing coarser, and its triangles read
// uncovered — the reading the no-hole proof takes under WebGL2.
test('the image cut counts as uncovered only a surface nothing resident draws', () => {
  const { image, cut, dag, pages, drawnIds, held } = strip(1000, wholeStrip());
  for (let i = 0; i < 24; i++) image(0.25);
  assert.equal(cut().uncoveredTriangles, 0, 'a full view has no hole');
  const take = (page: DagPage) => {
    page.array = undefined;
    held.moved(page);
  };
  const fine = pages.find((page) => page.parentError !== null && page.array)!;
  take(fine);
  image(0.25, 0);
  assert.equal(coverFault(dag, drawnIds()), -1, 'an ancestor stands in for the missing page');
  assert.equal(cut().uncoveredTriangles, 0, 'a covered surface is no hole');
  const root = pages.find((page) => page.parentError === null)!;
  take(root);
  image(0.25, 0);
  assert.notEqual(coverFault(dag, drawnIds()), -1, 'the surface under the root is not drawn');
  assert.equal(cut().uncoveredTriangles, root.triangles, 'its triangles read uncovered');
});

/** Clusters nothing replaces in the rule DAG: its root cover. */
function dag0Roots() {
  return ruleDag(256).pages.filter((page) => page.parentError === null).length;
}

/** The DAG level drawing each leaf unit of the rule DAG. */
function levels(dag: ReturnType<typeof ruleDag>, drawn: number[]) {
  const at = new Int32Array(dag.leaves);
  for (const id of drawn) {
    const [a, b] = dag.pages[id].units;
    at.fill(dag.pages[id].level, a, b);
  }
  return at;
}

// #839: a budget cut mid-session — to about half the fine cut, and down to the starvation run's root
// cover plus a tenth — is paid one level per image: every page an image drew survives to the next
// cut, the residency holds the ancestors each surface falls back to, and the pool converges.
for (const [label, budget] of [
  ['half the fine cut', 30],
  ['the root cover and a tenth', Math.ceil(dag0Roots() * 1.1)],
] as const)
  test(`a budget cut to ${label}: no hole, drawn pages kept, one level coarser per image`, () => {
    const { image, dag, pages, drawnIds, pool, state } = strip(1000, wholeStrip());
    for (let i = 0; i < 24; i++) image(0.25);
    let before = levels(dag, drawnIds()),
      drawn = drawnIds();
    pool.resize(budget * PAGE);
    for (let i = 0; i < 24; i++) {
      assert.ok(
        drawn.every((id) => pages[id].array),
        `image ${i}: a drawn page left`,
      );
      image(0.25, 3);
      drawn = drawnIds();
      assert.equal(coverFault(dag, drawn), -1, `image ${i}: a leaf not covered exactly once`);
      const now = levels(dag, drawn);
      for (let u = 0; u < dag.leaves; u++)
        assert.ok(now[u] <= before[u] + 1, `image ${i}, leaf ${u}: ${before[u]} → ${now[u]}`);
      before = now;
    }
    assert.ok(state.allocationBytes <= budget * PAGE, 'the pool converged to its budget');
  });
