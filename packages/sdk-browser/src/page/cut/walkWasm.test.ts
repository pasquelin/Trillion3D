// The cut's node walk in WebAssembly (`walkWasm.ts`, `packages/page-codec-wasm/src/cut.rs`)
// against the JavaScript descent (`visit.ts`): the same cut to the bit — the same page objects in
// the same order, the same counters, the same threshold — on two hierarchy shapes, perspective and
// orthographic eyes, zero and positive thresholds, held residency and missing groups.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as G from '../../host/graph/graph.fixture.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';
import { prepareSdkWasm } from '../decode/geometryPageWasm.ts';
import { mathBatchMetrics, prepareMathBatch } from '../../math/batchState.ts';
import { scenePages, sceneRoots } from '../../gpu/dag/cutFrontierScene.fixture.ts';
import { culledDagRoots } from '../selection/helpers.fixture.ts';
import { obliqueCamera, wideCamera } from '../selection/dag.fixture.ts';
import { BOUND_STRIDE, cullingBounds } from './bounds.ts';
import { ruleDag } from './cutRule.fixture.ts';
import { selectVisiblePages } from './cut.ts';
import { CUT_WALK, cutWalkRuns } from './walkWasm.ts';
import type { ClusterRoot } from '../selection/types.ts';
import type { PageRecord } from './state.ts';

await prepareSdkWasm(readFileSync(join(import.meta.dirname, '../decode/pageCodec.wasm')));

/** Twelve placements of a 6-level pyramid, on the packing or the compiler hierarchy. */
function pyramid(byLevel: boolean) {
  const pages = scenePages(2048, 6);
  const worlds = Array.from({ length: 12 }, (_, w) =>
    new G.Matrix4().makeTranslation((w % 4) * 6.5 - 9.75, Math.floor(w / 4) * 6.5 - 6.5, -8),
  );
  const roots = sceneRoots(pages, worlds, byLevel);
  const culling = roots[0].culling!;
  const bounds = cullingBounds(culling, pages);
  for (const root of roots) root.culling = { ...culling, bounds };
  return roots as unknown as ClusterRoot<PageRecord>[];
}

function eye(from: [number, number, number], at: [number, number, number], ortho = false) {
  const cam = ortho
    ? G.orthographicCamera(-12, 12, 7, -7, 0.1, 500)
    : G.perspectiveCamera(55, 16 / 9, 0.1, 500);
  cam.position.set(...from);
  cam.lookAt(...at);
  cam.updateMatrixWorld();
  return cameraMoteur(cam);
}

const EYES = [
  eye([0, 0, 12], [0, 0, -8]),
  eye([14, 6, 4], [-3, -2, -8]),
  eye([0, 0, 40], [0, 0, -8]),
  eye([2, 1, 3], [2, 1, -20]),
  eye([0, 0, 12], [0, 0, -8], true),
];

const ASKS = [
  { pixelError: 0 },
  { pixelError: 1 },
  { pixelError: 6 },
  {
    pixelError: 1,
    holdResident: true,
    isResident: (p: PageRecord) => p.triangles % 3 !== 0,
  },
];

/** One cut under a forced path, its lists copied out of the reused state. */
async function cut(
  roots: ClusterRoot<PageRecord>[],
  cam: ReturnType<typeof eye>,
  ask: object,
  path: 'js' | 'wasm',
) {
  await prepareMathBatch(path);
  const r = selectVisiblePages(roots, cam, { viewport: [1280, 720], ...ask });
  return { ...r, shown: [...r.shown], wanted: [...r.wanted] };
}

async function assertSameCut(
  roots: ClusterRoot<PageRecord>[],
  cam: ReturnType<typeof eye>,
  ask: object,
  label: string,
) {
  const js = await cut(roots, cam, ask, 'js');
  const walked = cutWalkRuns.walked;
  const wasm = await cut(roots, cam, ask, 'wasm');
  assert.ok(cutWalkRuns.walked > walked, `${label}: the kernel walked`);
  assert.equal(wasm.shown.length, js.shown.length, `${label}: shown count`);
  assert.equal(wasm.wanted.length, js.wanted.length, `${label}: wanted count`);
  wasm.shown.forEach((page, i) => assert.equal(page, js.shown[i], `${label}: shown[${i}]`));
  wasm.wanted.forEach((page, i) => assert.equal(page, js.wanted[i], `${label}: wanted[${i}]`));
  for (const key of [
    'visible',
    'selectedTriangles',
    'displayedTriangles',
    'frustumRejected',
    'nodesTested',
    'lodLevel',
    'complete',
    'pixelError',
  ] as const)
    assert.ok(
      Object.is(wasm[key], js[key]),
      `${label}: ${key} ${String(wasm[key])} ≠ ${String(js[key])}`,
    );
}

for (const byLevel of [false, true])
  test(`cut walk: same cut in JavaScript and WebAssembly, ${byLevel ? 'compiler' : 'packing'} hierarchy`, async () => {
    const roots = pyramid(byLevel);
    const bailed = cutWalkRuns.bailed;
    for (const [e, cam] of EYES.entries())
      for (const [a, ask] of ASKS.entries())
        await assertSameCut(roots, cam, ask, `eye ${e}, ask ${a}`);
    assert.equal(cutWalkRuns.bailed, bailed, 'no walk handed back to JavaScript');
    assert.ok(
      (mathBatchMetrics().operations[CUT_WALK]?.wasmSamples ?? 0) > 0,
      'the governor saw the kernel',
    );
  });

test('cut walk: same cut on the prepared DAG fixture, held at a zero threshold', async () => {
  const { roots, fixture } = culledDagRoots();
  for (const cam of [cameraMoteur(wideCamera()), cameraMoteur(obliqueCamera())])
    for (const ask of [{ pixelError: 0, holdResident: true }, { pixelError: 2 }])
      await assertSameCut(roots as ClusterRoot<PageRecord>[], cam, ask, 'dag fixture');
  fixture.geometry.dispose();
});

test('cut walk: same cut on a DAG missing pages, its open subtrees walked past their floor', async () => {
  const dag = ruleDag(256),
    pages = dag.pages as PageRecord[];
  const roots = [
    { world: dag.world, pages, culling: dag.culling, structure: dag.structure },
  ] as ClusterRoot<PageRecord>[];
  const cam = eye([-6, 4, 0], [128, 0, 0]);
  let opened = 0;
  for (const keep of [1, 0.8, 0.5]) {
    // Every root resident, the rest kept at random: a missing group opens the nodes above it.
    const resident = new Set(
      pages.filter((p, i) => p.group === null || (i * 7919) % 100 < keep * 100),
    );
    const ask = {
      pixelError: 0.1,
      holdResident: true,
      isResident: (p: PageRecord) => resident.has(p),
    };
    await assertSameCut(roots, cam, ask, `keep ${keep}`);
    const drawn = (await cut(roots, cam, ask, 'js')).shown.filter((p) => p.lodError! > 0.1).length;
    if (keep < 1) opened += drawn;
  }
  assert.ok(opened > 0, 'no cluster above the threshold drawn: no open subtree walked');
});

test('cut walk: a hierarchy outside the kernel domain throws what the JavaScript cut throws', async () => {
  const roots = pyramid(false);
  const culling = roots[0].culling!;
  // A NaN own ceiling on every node: the projection refuses it, and the JavaScript descent throws.
  const bounds = culling.bounds.slice();
  for (let at = 1; at < bounds.length; at += BOUND_STRIDE) bounds[at] = NaN;
  for (const root of roots) root.culling = { ...culling, bounds };
  const bailed = cutWalkRuns.bailed;
  for (const path of ['js', 'wasm'] as const) {
    await prepareMathBatch(path);
    assert.throws(
      () => selectVisiblePages(roots, EYES[0], { pixelError: 1, viewport: [1280, 720] }),
      /Invalid cluster parameters/,
      path,
    );
  }
  assert.ok(cutWalkRuns.bailed > bailed, 'the kernel handed the walk back');
  await prepareMathBatch('auto');
});
