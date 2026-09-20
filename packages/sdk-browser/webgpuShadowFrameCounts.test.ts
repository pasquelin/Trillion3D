// The cumulative shadow page count the lesson and hosts read: it grows by what each frame drew,
// nothing when the pass could not be encoded, and the sampled cull counts sum the device's own
// instance counts. Also the hold: a representation change held until rest keeps the frame
// rendering only while there is an atlas and a light to plan it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuLightState, noteShadowFrame } from './webgpuPagesStateLights.ts';
import { sumKeptClusters } from './gpuShadowCullCounts.ts';
import { unsettledMask } from './webgpuFrameHold.ts';
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

test('a deferred representation change keeps the frame from holding only with an atlas and a light', () => {
  const rt = settledRt();
  const lights = rt.lights as unknown as {
    plan: { counts: { pendingPages: number }; deferredChanges: boolean };
    shadows: unknown;
    store: { count: number };
  };
  lights.plan.deferredChanges = true;
  lights.shadows = undefined;
  lights.store = { count: 1 };
  assert.equal(
    unsettledMask(rt),
    0,
    'no atlas: nothing will ever plan the change, the frame holds',
  );
  lights.shadows = {};
  lights.store.count = 0;
  assert.equal(unsettledMask(rt), 0, 'no light: same');
  lights.store.count = 1;
  assert.notEqual(unsettledMask(rt), 0, 'an atlas and a light: the next frame plans the change');
});
