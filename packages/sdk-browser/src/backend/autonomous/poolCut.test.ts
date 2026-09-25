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
  // The image that sees the smaller budget asks for less; the next one releases what it no longer
  // asks for, before its cut draws their ancestors.
  for (let frame = 0; frame < 12; frame++) {
    const most = image(1);
    if (frame > 0)
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

/** Clusters nothing replaces in the rule DAG: its root cover. */
function dag0Roots() {
  return ruleDag(256).pages.filter((page) => page.parentError === null).length;
}
