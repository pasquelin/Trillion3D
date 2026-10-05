import test from 'node:test';
import assert from 'node:assert/strict';
import { settledRt } from '../webgpu/frame/hold.fixture.ts';
import { reflectionFrame } from './reflectionFrame.ts';
import { createReflectionHistory } from './historyRuntime.ts';
import { resolveHistory } from './historyFrame.fixture.ts';
import { restartTaaOnShadowLanding } from '../taa/landing.ts';
import { createTaaFrameState } from '../taa/frameState.ts';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';

/** The source versions a frame carries, copied: the frame's own array is rewritten in place. */
const epochOf = (rt: Parameters<typeof reflectionFrame>[0]) => [...reflectionFrame(rt)!.epoch];
const lightingOf = (rt: Parameters<typeof reflectionFrame>[0]) => [
  ...reflectionFrame(rt)!.lighting,
];

/** A settled runtime with every surface its reflection reads, 4 shadow pages drawn so far. */
function reflectingRt() {
  const rt = settledRt();
  rt.gpu.reflection = { active: true } as NonNullable<typeof rt.gpu.reflection>;
  rt.gpu.depthTexture = {} as GPUTexture;
  rt.gpu.surfaces = { normalRough: {} } as NonNullable<typeof rt.gpu.surfaces>;
  rt.vis.visTexture = {} as GPUTexture;
  rt.vis.visView = {} as GPUTextureView;
  rt.vis.pageTable = {} as GPUBuffer;
  rt.lights.vsm = { settle: { renderedTotal: 4 } } as NonNullable<typeof rt.lights.vsm>;
  return rt;
}

test('a shadow page landing changes the reflected source epoch without a host mutation', () => {
  const rt = reflectingRt();
  const previous = epochOf(rt);
  const lighting = lightingOf(rt);
  const revisions = { ...rt.run.gate.revisions };
  rt.lights.vsm!.settle.renderedTotal += 2;
  assert.deepEqual(rt.run.gate.revisions, revisions);
  assert.notDeepEqual(epochOf(rt), previous);
  // #1342: a shadow page follows a placement or the camera; only lights and materials relight.
  assert.deepEqual(lightingOf(rt), lighting, 'a shadow page keeps the lighting');
  const landed = epochOf(rt);
  assert.deepEqual(epochOf(rt), landed, 'unchanged shadow contents permit convergence');
  const deformation = { revision: 1 };
  rt.vis.deformation = { frame: deformation } as NonNullable<typeof rt.vis.deformation>;
  const pose = epochOf(rt);
  deformation.revision++;
  assert.notDeepEqual(epochOf(rt), pose, 'a changed deformation invalidates the reflected source');
  const current = epochOf(rt);
  assert.deepEqual(epochOf(rt), current, 'an unchanged pose permits convergence');
});

test('#1346: a still image wakes neither the reflection nor the TAA until a shadow page is drawn', () => {
  const gpu = fakeDevice();
  const rt = reflectingRt();
  const current = gpu.device.createTexture({ size: [8, 8], format: 'rgba16float', usage: 1 });
  rt.gpu.depthTexture = current;
  rt.gpu.surfaces = { normalRough: current } as NonNullable<typeof rt.gpu.surfaces>;
  rt.vis.visTexture = current;
  Object.assign(rt.lights, { store: { transportEpoch: 0 } });
  const settle = rt.lights.vsm!.settle;
  const taa = Object.assign(createTaaFrameState(), { active: true, hasHistory: true });
  rt.gpu.temporal = { frame: taa, motion: { buffer: {} } } as never;
  const history = createReflectionHistory(gpu.device, 8, 8, {
    depth: {} as GPUTextureView,
    ids: {} as GPUTextureView,
  });
  // A still image: its reflection resolved, the landings seen, one more frame in the average.
  const draw = () => {
    rt.run.frame++;
    resolveHistory(gpu.device, history, reflectionFrame(rt)!, current, [8, 8]);
    restartTaaOnShadowLanding(rt);
    taa.stillFrames++;
  };
  try {
    for (let i = 0; i < 40 && !history.settled; i++) draw();
    assert.equal(history.settled, true, 'the reflection rested');
    // Two more frames with no page drawn.
    const still = taa.stillFrames;
    draw();
    draw();
    assert.equal(history.settled, true, 'the reflection history stays settled');
    assert.deepEqual(
      [taa.stillFrames, taa.hasHistory],
      [still + 2, true],
      'the TAA average goes on',
    );
    // A page drawn changes the image: both restart on it.
    settle.renderedTotal++;
    draw();
    assert.equal(history.settled, false, 'the drawn page reopens the reflection window');
    assert.deepEqual([taa.stillFrames, taa.hasHistory], [1, false], 'and restarts the TAA average');
  } finally {
    history.dispose();
  }
});
