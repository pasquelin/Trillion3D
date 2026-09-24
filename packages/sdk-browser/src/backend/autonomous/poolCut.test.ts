import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import { createSelectionResult, selectVisiblePages } from '../../page/selection/selection.ts';
import type { BackendDiagnostic } from '../types.ts';
import { dag, racine, type DagPage } from '../../../../../bench/perf/browser/support/dagCut.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';
import { createGeometryBudget } from './pool.ts';

const PAGE = 100;

/**
 * A DAG of 511 pages of `PAGE` bytes, only its root resident, drawn by the pool and the cut as the
 * WebGL2 frame draws them (`render.ts`): the pages an image asks for arrive before the next.
 */
function mount(budgetBytes: number) {
  const pages = dag({ feuilles: 256, seed: 11, residentes: 0 });
  const root = pages.find((page) => page.parentError === null)!;
  root.array = new Uint32Array(3);
  const byUrl = new Map(pages.map((page) => [page.url, page]));
  const shares = new Map(pages.map((page) => [page.url, { pass: 0, slots: 0 }]));
  for (const page of pages) page.budgetShare = shares.get(page.url);
  const state = { allocationBytes: PAGE },
    kept = new Set<string>(),
    diagnostics: BackendDiagnostic[] = [];
  const pool = createGeometryBudget({
    budgetBytes,
    ceilingBytes: 1000 * PAGE,
    descriptors: new Map(
      pages.map((page) => [page.url, { uncompressedBytes: PAGE } as GeometryPageDescriptor]),
    ),
    rootUrls: new Set([root.url]),
    copies: { generation: 0, of: () => 1, root: () => 1, scene: () => pages.length },
    shares,
    state,
    floorBytes: () => PAGE,
    kept: () => kept,
    drop: (url) => {
      const page = byUrl.get(url)!;
      if (!page.array) return;
      page.array = undefined;
      state.allocationBytes -= PAGE;
    },
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200);
  camera.position.set(0, 0, 9);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const roots = [racine(pages)],
    shown: DagPage[] = [];
  const cut = {
    pixelError: 0,
    viewport: [1280, 720] as [number, number],
    holdResident: true,
    pageBudget: 0,
    pageBudgetHeld: 0,
    pageBudgetFrom: 0,
    wanted: [] as DagPage[],
    result: createSelectionResult<DagPage>(),
  };
  /** One image at the host's `pixelError`, then the pages it asked for; returns the most the
   *  pages held meanwhile. */
  const image = (pixelError: number) => {
    cut.pixelError = pixelError;
    pool.bound(cut);
    const drawn = selectVisiblePages(roots, cameraMoteur(camera), cut, shown);
    pool.settle(pixelError, drawn);
    kept.clear();
    kept.add(root.url);
    for (const page of drawn.shown) kept.add(page.url);
    for (const page of drawn.wanted) kept.add(page.url);
    pool.trim();
    let most = state.allocationBytes;
    for (const page of drawn.wanted)
      if (!page.array) {
        page.array = new Uint32Array(3);
        state.allocationBytes += PAGE;
        pool.arrived(page.url);
        most = Math.max(most, state.allocationBytes);
      }
    return most;
  };
  return { pool, state, diagnostics, image, drawn: () => shown.length };
}

test('after a smaller budget no image holds more than it: the cut fits it in the image drawn', () => {
  const { pool, state, diagnostics, image, drawn } = mount(1000 * PAGE);
  for (let frame = 0; frame < 12; frame++) image(1);
  const fine = drawn();
  assert.ok(state.allocationBytes > 40 * PAGE, `a fine cut to shrink: ${fine} pages`);
  assert.equal(pool.budgetPixelError, 0);
  pool.resize(20 * PAGE);
  for (let frame = 0; frame < 12; frame++) {
    const most = image(1);
    assert.ok(most <= 20 * PAGE, `image ${frame}: ${most / PAGE} pages for 20 slots`);
  }
  assert.ok(pool.budgetPixelError > 1, 'the cut is drawn coarser');
  assert.equal(pool.coverageBudgetLimited, true);
  assert.equal(pool.settling, false, 'the search settled on the finest step that fits');
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
  assert.equal(published[0].context?.pixelError, 1);
  assert.equal(published[0].context?.requiredSlots, null, 'not known from a stopped pass');
  // A larger budget, still short of the scene, brings the detail back one step of √2 an image,
  // asking for each image.
  pool.resize(400 * PAGE);
  assert.equal(pool.settling, true, 'a larger pool owes an image');
  let images = 0;
  do image(1);
  while (pool.settling && ++images < 40);
  assert.ok(images > 1 && images < 40, `${images} images to settle`);
  assert.ok(state.allocationBytes <= 400 * PAGE);
  assert.equal(pool.budgetPixelError, 0);
  assert.equal(pool.coverageBudgetLimited, false);
  for (let frame = 0; frame < 12; frame++) image(1);
  assert.equal(drawn(), fine, 'the same cut as before the budget changed');
  pool.flush();
  const back = diagnostics.filter(({ phase }) => phase === 'coverage-budget');
  assert.equal(back.length, 2);
  assert.equal(back[1].context?.limited, false);
  assert.ok((back[1].context?.requiredSlots as number) > 20, 'the cut the host asked for, counted');
});
