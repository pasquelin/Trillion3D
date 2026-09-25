// The cumulative shadow page count the lesson and hosts read: it grows by what each frame drew,
// and the sampled cull counts sum the device's own instance counts. Also the hold: a
// representation change held until rest keeps the frame rendering until a plan consumes it, or a
// frame that plans no shadow releases it to the list.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWebgpuLightState,
  noteShadowFrame,
  shadowsUnsettled,
} from '../pages/state/lights.ts';
import { createGpuShadowCullCounts, sumKeptClusters } from '../../gpu/shadow/cullCounts.ts';
import { unsettledMask } from '../frame/hold.ts';
import { planShadowRegions, shadowViewpointOf } from '../pages/render/encodeShadows.ts';
import { encodeDirectLights } from '../pages/render/encodeLights.ts';
import type { SceneLight } from '../../../../sdk-core/src/index.ts';
import { settledRt } from '../frame/hold.fixture.ts';
import { sunEntry } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

installGpuGlobals();

test('shadowPagesTotal accumulates the pages each frame drew', () => {
  const lights = createWebgpuLightState(32);
  lights.shadowPages = 12;
  noteShadowFrame(lights);
  lights.shadowPages = 8;
  noteShadowFrame(lights);
  assert.equal(lights.shadowPagesTotal, 20);
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
  const lights = createWebgpuLightState(32);
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
  const lights = createWebgpuLightState(32);
  (rt as unknown as { lights: unknown }).lights = lights;
  rt.gpu.targetSize = [8, 8];
  const { store, plan } = lights;
  store.add(SUN);
  const view = shadowViewpointOf(CAM as never, 8);
  const planAt = (frame: number) => plan.plan(store, view, BOX_MIN, BOX_MAX, frame, frame * 16);
  planAt(0);
  const slice = store.sliceOf(0);
  // The shading read one page; it and the floor the view reached at the sun's first frame — four
  // pages, one under it — are mapped and drawn.
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
  assert.equal(plan.pool.used, 1 + 4, 'the page and the floor are mapped');
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
  assert.equal(plan.deferredChanges, false, 'the unlit frame holds no change');
  store.setView('auto');
  planAt(2);
  // The page, and the four floor pages the view reaches: the sun asks for them every frame.
  assert.equal(plan.counts.invalidatedPages, 1 + 4, 'the first lit plan stales the changed pages');
});

test('pages a plan left pending hold nothing once the view is unlit or the light is gone', () => {
  const lights = createWebgpuLightState(32);
  lights.shadows = {} as never;
  lights.store.add(SUN);
  const view = shadowViewpointOf(CAM as never, 8);
  lights.plan.plan(lights.store, view, BOX_MIN, BOX_MAX, 0, 0);
  lights.plan.counts.pendingPages = 300;
  assert.equal(shadowsUnsettled(lights), true, 'a lit view waits for its pages');
  lights.store.setView('unlit');
  assert.equal(shadowsUnsettled(lights), false, 'the unlit view reads none of them');
  lights.store.setView('auto');
  lights.store.remove(SUN.id);
  assert.equal(shadowsUnsettled(lights), false, 'nor does a scene without light');
});

/**
 * The device of the sample: its readback mapping resolves only when the test says so, and its
 * mapped range carries the given words.
 */
function samplingDevice(words: Uint32Array) {
  let mapped!: () => void;
  const mapping = new Promise<void>((resolve) => {
    mapped = resolve;
  });
  const { device, buffers } = fakeDevice({ mapping });
  const counts = createGpuShadowCullCounts(device);
  new Uint32Array(buffers[0]!.getMappedRange()).set(words);
  return { counts, encoder: device.createCommandEncoder(), mapped };
}

test('a sampled cull count is named by the frame it describes, only once it has returned', async () => {
  const { counts, encoder, mapped } = samplingDevice(new Uint32Array([32768, 22, 0, 0]));
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

// A frame draws its pages in batches (#489): the sampled frame copies every batch's commands after
// the last, so the count covers all its pages, and the frames after it copy nothing.
test('a sampled cull count covers every batch of its frame', async () => {
  const words = new Uint32Array(8);
  words[1] = 22;
  words[5] = 7;
  const { counts, encoder, mapped } = samplingDevice(words);
  const copies: number[][] = [];
  Object.assign(encoder, {
    copyBufferToBuffer: (_s: GPUBuffer, _o: number, _d: GPUBuffer, at: number, size: number) => {
      copies.push([at, size]);
    },
  });
  const indirect = {} as GPUBuffer;
  counts.sample(encoder, indirect, 1, 40);
  counts.sample(encoder, indirect, 1, 40);
  counts.submitted();
  counts.sample(encoder, indirect, 1, 41);
  assert.deepEqual(copies, [
    [0, 16],
    [16, 16],
  ]);
  mapped();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(counts.counts(), { frame: 40, regions: 2, kept: 29 });
  counts.dispose();
});
