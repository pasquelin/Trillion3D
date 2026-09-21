// The cumulative shadow page count the lesson and hosts read: it grows by what each frame drew,
// nothing when the pass could not be encoded, and the sampled cull counts sum the device's own
// instance counts. Also the hold: a representation change held until rest keeps the frame
// rendering until a plan consumes it, or drops it when no frame will ever plan it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuLightState, noteShadowFrame } from './webgpuPagesStateLights.ts';
import { createGpuShadowCullCounts, sumKeptClusters } from './gpuShadowCullCounts.ts';
import { unsettledMask } from './webgpuFrameHold.ts';
import { planShadowRegions } from './webgpuPagesEncodeShadows.ts';
import { settledRt } from './webgpuFrameHoldFixture.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';

installGpuGlobals();

test('shadowPagesTotal accumulates drawn pages and skips a frame whose pass was refused', () => {
  const lights = createWebgpuLightState();
  lights.shadowPages = 12;
  lights.shadowRegions = 2;
  lights.pagesByFrame[3] = 12;
  noteShadowFrame(lights, 3, true);
  assert.equal(lights.shadowPagesTotal, 12);
  lights.shadowPages = 8;
  lights.pagesByFrame[4] = 8;
  noteShadowFrame(lights, 4, false);
  assert.equal(lights.shadowPagesTotal, 12, 'a refused pass drew nothing');
  assert.deepEqual([lights.shadowPages, lights.shadowRegions, lights.pagesByFrame[4]], [0, 0, 0]);
});

test('the sampled cull counts sum the instance count of each region command', () => {
  // Three commands of four words: vertex count, instance count, first vertex, first instance.
  const words = new Uint32Array([32768, 67, 0, 0, 32768, 5, 0, 0, 32768, 900, 0, 0]);
  assert.equal(sumKeptClusters(words, 2), 72);
  assert.equal(sumKeptClusters(words, 3), 972);
});

test('a deferred representation change keeps the frame from holding until a plan consumes or drops it', () => {
  const rt = settledRt();
  const lights = createWebgpuLightState();
  (rt as unknown as { lights: unknown }).lights = lights;
  lights.plan.representationChanged([0, 0, 0], [1, 1, 1]);
  assert.notEqual(unsettledMask(rt), 0, 'a change waits: the next frame must plan it');
  // No atlas: no frame will ever plan the change, so the plan drops it and the frame holds.
  const cam = {
    eye: [0, 0, 0],
    world: new Float64Array(16),
    fov: 60,
    aspect: 1,
    near: 0.1,
    far: 100,
  };
  planShadowRegions(rt, cam as never, 1, 16);
  assert.equal(lights.plan.deferredChanges, false);
  assert.equal(unsettledMask(rt), 0);
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
