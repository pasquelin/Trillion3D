// #412 step A1: every camera-bound state is held per view, behind one record, and switched in one
// function (`state/viewSwitch.ts`); a capture draws in a view of its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { quadScene, camera } from './testScenes.fixture.ts';
import { createWebgpuPagesRuntime } from './runtime.ts';
import { prepareWebgpuBackend } from './prepare/prepare.ts';
import { renderWebgpuPages } from './render/render.ts';
import { flushWebgpuPages } from './render/flush.ts';
import { captureColorView } from './io/colorCapture.ts';
import { VIEW_GPU_KEYS, VIEW_RUN_KEYS, VIEW_VIS_KEYS, createWebgpuView } from './state/view.ts';
import { releaseWebgpuView, useWebgpuView } from './state/viewSwitch.ts';

/** The red quad on a prepared runtime, its main view drawn twice from the front. */
async function drawnQuad(compute: boolean) {
  installGpuGlobals();
  const gpu = mockGpu({ compute });
  const fixture = quadScene();
  const rt = createWebgpuPagesRuntime({
    ...fixture,
    gpuDevice: gpu.device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  await prepareWebgpuBackend(rt, gpu.device);
  for (let i = 0; i < 2; i++) {
    renderWebgpuPages(rt, camera());
    await flushWebgpuPages(rt);
  }
  return { rt, gpu };
}

/** A camera beside the quad, looking away from it. */
function awayCamera() {
  const away = G.perspectiveCamera(55, 1, 0.1, 100);
  away.position.set(0, 0, 3);
  away.lookAt(0, 0, 6);
  away.updateMatrixWorld();
  return away;
}

/** What the main view holds in the runtime groups, by reference. */
function heldBy(rt: Awaited<ReturnType<typeof drawnQuad>>['rt']) {
  return [
    ...VIEW_RUN_KEYS.map((key) => rt.run[key]),
    ...VIEW_GPU_KEYS.map((key) => rt.gpu[key]),
    ...VIEW_VIS_KEYS.map((key) => rt.vis[key]),
    rt.run.gate.cam,
  ];
}

test('no reader keeps the main view once another is drawn, and switching back finds it whole', async () => {
  const { rt } = await drawnQuad(true);
  const main = heldBy(rt),
    shown = [...rt.run.shown],
    eye = [...rt.run.gate.cam.eye],
    temporal = rt.gpu.temporal!,
    sample = temporal.frame.sample;
  assert.ok(temporal.frame.hasHistory && rt.run.previousHizView && rt.vis.gpuHiz);
  const side = createWebgpuView(16, 16);
  useWebgpuView(rt, side);
  const objects = (values: unknown[]) => values.filter((v) => typeof v === 'object' && v);
  for (const value of objects(heldBy(rt)))
    assert.equal(objects(main).includes(value), false, 'a group still names the main view');
  renderWebgpuPages(rt, awayCamera());
  await flushWebgpuPages(rt);
  assert.deepEqual(rt.gpu.targetSize, [16, 16]);
  assert.equal(rt.vis.gpuHiz!.width, 16, 'the shared pyramid follows the drawn view');
  assert.equal(rt.gpu.temporal, undefined, 'the side view accumulates no history of its own yet');
  assert.notDeepEqual([...rt.run.gate.cam.eye], eye);
  useWebgpuView(rt, rt.views.main);
  assert.deepEqual(heldBy(rt), main, 'the main view gets back every state it held');
  assert.deepEqual(rt.run.shown, shown);
  assert.deepEqual([...rt.run.gate.cam.eye], eye);
  assert.deepEqual(rt.setup.viewport, [32, 32]);
  assert.equal(rt.vis.gpuHiz!.width, 32);
  assert.equal(temporal.frame.hasHistory, true);
  assert.equal(temporal.frame.sample, sample);
  releaseWebgpuView(rt, side);
});

test('the row table follows the cut of the view drawn, not the one it was built on', async () => {
  const { rt } = await drawnQuad(false);
  assert.equal(rt.run.drawn.length, 2);
  const side = createWebgpuView(32, 32);
  useWebgpuView(rt, side);
  renderWebgpuPages(rt, awayCamera());
  await flushWebgpuPages(rt);
  assert.equal(rt.run.drawn.length, 0);
  assert.equal(rt.layout.rows.packedCount, 0, 'no row is drawn for a cut the view does not hold');
  useWebgpuView(rt, rt.views.main);
  renderWebgpuPages(rt, camera());
  await flushWebgpuPages(rt);
  assert.equal(rt.layout.rows.packedCount, 2);
  releaseWebgpuView(rt, side);
});

test('a capture leaves the main view’s targets, TAA and Hi-Z history intact', async () => {
  const { rt, gpu } = await drawnQuad(true);
  const main = heldBy(rt),
    temporal = rt.gpu.temporal!,
    frame = { ...temporal.frame },
    noOccluderHistory = rt.run.noOccluderHistory,
    textures = gpu.textures.length;
  const pixels = await captureColorView(rt, awayCamera(), { width: 16, height: 16 });
  assert.equal(pixels.length, 16 * 16 * 4);
  assert.equal(rt.views.active, rt.views.main);
  assert.deepEqual(heldBy(rt), main);
  assert.deepEqual({ ...temporal.frame }, frame);
  assert.equal(rt.run.noOccluderHistory, noOccluderHistory);
  assert.deepEqual(rt.setup.viewport, [32, 32]);
  assert.equal(rt.capture.capturing, false);
  const made = gpu.textures.slice(textures).filter((texture) => texture.width === 16);
  assert.ok(made.length && made.every((texture) => texture.destroyed), 'the capture view is freed');
});
