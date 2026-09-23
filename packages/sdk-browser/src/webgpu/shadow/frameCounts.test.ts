// The cumulative shadow page count the lesson and hosts read: it grows by what each frame drew,
// nothing when the pass could not be encoded, and the sampled cull counts sum the device's own
// instance counts. Also the hold: a representation change held until rest keeps the frame
// rendering until a plan consumes it, or a frame that plans no shadow releases it to the list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuLightState, noteShadowFrame } from '../pages/state/lights.ts';
import { createGpuShadowCullCounts, sumKeptClusters } from '../../gpu/shadow/cullCounts.ts';
import { unsettledMask } from '../frame/hold.ts';
import { planShadowRegions, shadowViewpointOf } from '../pages/render/encodeShadows.ts';
import { encodeDirectLights } from '../pages/render/encodeLights.ts';
import type { SceneLight } from '../../../../sdk-core/src/index.ts';
import { settledRt } from '../frame/hold.fixture.ts';
import { sunEntry } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';

installGpuGlobals();

test('shadowPagesTotal accumulates drawn pages and skips a frame whose pass was refused', () => {
  const lights = createWebgpuLightState();
  lights.shadowPages = 12;
  lights.pagesByFrame[3] = 12;
  noteShadowFrame(lights, 3, true);
  assert.equal(lights.shadowPagesTotal, 12);
  lights.shadowPages = 8;
  lights.pagesByFrame[4] = 8;
  noteShadowFrame(lights, 4, false);
  assert.equal(lights.shadowPagesTotal, 12, 'a refused pass drew nothing');
  assert.deepEqual([lights.shadowPages, lights.pagesByFrame[4]], [0, 0]);
});

test('the sampled cull counts sum the instance count of each region command', () => {
  // Three commands of four words: vertex count, instance count, first vertex, first instance.
  const words = new Uint32Array([32768, 67, 0, 0, 32768, 5, 0, 0, 32768, 900, 0, 0]);
  assert.equal(sumKeptClusters(words, 2), 72);
  assert.equal(sumKeptClusters(words, 3), 972);
});

const CAM = {
  eye: [0, 5, 0],
  world: new Float64Array(16),
  projection: Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0.1, 0),
  fov: 60,
  aspect: 1,
  near: 0.1,
  far: 100,
};
const BOX_MIN = [-10, 0, -10],
  BOX_MAX = [10, 5, 10];
const SUN: SceneLight = {
  id: 'sun',
  kind: 'directional',
  direction: [0, -1, 0],
  color: [1, 1, 1],
  intensity: 1,
  castsShadow: true,
};

test('a deferred representation change keeps the frame from holding until a plan consumes or releases it', () => {
  const rt = settledRt();
  const lights = createWebgpuLightState();
  (rt as unknown as { lights: unknown }).lights = lights;
  lights.plan.representationChanged([0, 0, 0], [1, 1, 1]);
  assert.notEqual(unsettledMask(rt), 0, 'a change waits: the next frame must plan it');
  // No atlas: the frame plans nothing, releases the change to the list and holds.
  planShadowRegions(rt, CAM as never, 1, 16);
  assert.equal(lights.plan.deferredChanges, false);
  assert.equal(unsettledMask(rt), 0);
});

test('a representation change under an unlit frame stales its pages once the view is lit', () => {
  const rt = settledRt();
  const lights = createWebgpuLightState();
  (rt as unknown as { lights: unknown }).lights = lights;
  rt.gpu.targetSize = [8, 8];
  const { store, plan } = lights;
  store.add(SUN);
  const view = shadowViewpointOf(CAM as never, 8);
  const planAt = (frame: number) => plan.plan(store, view, BOX_MIN, BOX_MAX, frame, frame * 16);
  planAt(0);
  const slice = store.sliceOf(0);
  // The shading read one page; it is mapped and drawn.
  const entry = plan.table.baseOf(slice) + sunEntry(plan.sun.finest[slice] + 4, 0, 0);
  plan.receive({
    frame: 0,
    layoutEpoch: plan.table.layoutEpoch,
    stamp: 0,
    count: 1,
    entries: Uint32Array.of(entry),
  });
  planAt(1);
  plan.commit();
  assert.equal(plan.pool.used, 1, 'the page is mapped');
  // The slices survive the unlit view: what changes meanwhile must reach them.
  store.setView('unlit');
  plan.representationChanged([-1e3, 0, -1e3], [1e3, 2, 1e3]);
  encodeDirectLights(
    rt,
    undefined as never,
    undefined as never,
    CAM as never,
    new Float64Array(16),
  );
  assert.equal(plan.deferredChanges, false, 'the unlit frame holds no union');
  store.setView('auto');
  planAt(2);
  assert.equal(plan.counts.invalidatedPages, 1, 'the first lit plan stales the changed page');
});

/**
 * A device reduced to the sample: a readback buffer whose mapping resolves only when the test
 * says so, and whose mapped range carries the given words.
 */
function samplingDevice(words: Uint32Array) {
  let mapped!: () => void;
  const mapping = new Promise<void>((resolve) => {
    mapped = resolve;
  });
  const device = {
    createBuffer: () => ({
      destroy() {},
      mapAsync: () => mapping,
      getMappedRange: () => words.buffer,
      unmap() {},
    }),
  } as unknown as GPUDevice;
  const encoder = { copyBufferToBuffer() {} } as unknown as GPUCommandEncoder;
  return { device, encoder, mapped };
}

test('a sampled cull count is named by the frame it describes, only once it has returned', async () => {
  const { device, encoder, mapped } = samplingDevice(new Uint32Array([32768, 22, 0, 0]));
  const counts = createGpuShadowCullCounts(device);
  const indirect = {} as GPUBuffer;
  assert.equal(counts.counts(), undefined, 'nothing until a sample has returned');
  counts.sample(encoder, indirect, 1, 40);
  counts.submitted();
  assert.equal(counts.counts(), undefined, 'the copy of frame 40 is in flight: still nothing');
  mapped();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(counts.counts(), { frame: 40, regions: 1, kept: 22 });
  // Frame 55 is due: its copy is encoded, but until it returns the count stays frame 40's.
  counts.sample(encoder, indirect, 3, 55);
  assert.deepEqual(counts.counts(), { frame: 40, regions: 1, kept: 22 });
  counts.dispose();
});
