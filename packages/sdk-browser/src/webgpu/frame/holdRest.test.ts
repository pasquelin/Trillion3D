// #1346: once nothing changes, the world stops drawing within 20 frames — the TAA still average
// and the rough reflection's still window (`REFLECTION_STILL_FRAMES`) both close, and the hold
// takes over.
import test from 'node:test';
import assert from 'node:assert/strict';
import { holdWebgpuFrame, keepWebgpuFrame } from './hold.ts';
import { createTaaFrameState } from '../../taa/frameState.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { IDENTITY_MATRIX4 } from '../../../../sdk-core/src/index.ts';
import { settledRt } from './hold.fixture.ts';
import { createReflectionHistory } from '../../reflections/historyRuntime.ts';
import type { ReflectionHistoryFrame } from '../../reflections/historyFrame.ts';
import { stillHistoryFrame } from '../../reflections/historyFrame.fixture.ts';

installGpuGlobals();

const REST_FRAMES = 20;

/** Frames drawn, the changed one included, once `change` is made to a still world's reflection,
 *  before the hold takes over. */
function framesToRest(change: (frame: ReflectionHistoryFrame) => void) {
  const gpu = fakeDevice();
  const rt = settledRt();
  const taa = createTaaFrameState();
  Object.assign(rt.gpu, {
    temporalWanted: true,
    targetSize: [64, 32],
    allocatedSize: [64, 32],
    displaySize: [64, 32],
    temporal: { frame: taa, checkpoint() {}, replay: () => true },
    deferred: { usesContract: true },
  });
  Object.assign(rt.run, { diagnostic: 'beauty', textureConverging: false });
  // No shadow lands: the trace asks none (`sampleWgsl.test.ts`).
  Object.assign(rt.lights, { shadowPagesTotal: 0 });
  const history = createReflectionHistory(gpu.device, 64, 32, {
    depth: {} as GPUTextureView,
    ids: {} as GPUTextureView,
  });
  rt.gpu.reflection = { active: true, history } as unknown as NonNullable<typeof rt.gpu.reflection>;
  const current = gpu.device.createTexture({ size: [64, 32], format: 'rgba16float', usage: 1 });
  const frame = stillHistoryFrame(current, 0);
  const pass = { setViewport() {}, setPipeline() {}, setBindGroup() {}, draw() {}, end() {} };
  const encoder = {
    ...gpu.device.createCommandEncoder(),
    beginRenderPass: () => pass,
  } as unknown as GPUCommandEncoder;
  // What a drawn frame does to the reflection: its history resolved once.
  const draw = () => {
    frame.frame = ++rt.run.frame;
    history.prepare(frame, IDENTITY_MATRIX4, [64, 32]);
    history.encode(
      encoder,
      current.createView(),
      {} as GPURenderPipeline,
      {} as GPUBindGroupLayout,
    );
    keepWebgpuFrame(rt);
  };
  // A long-settled world first, then the change on the first still image.
  for (let i = 0; i < 200 && !holdWebgpuFrame(rt, gpu.device); i++) draw();
  assert.equal(history.settled, true, 'the world rested before the change');
  // The changed image is drawn, a moving one: the still average restarts after it.
  change(frame);
  taa.stillFrames = 0;
  draw();
  assert.equal(history.settled, false, 'the change reopened the reflection window');
  let drawn = 1;
  try {
    for (; drawn <= 100 && !holdWebgpuFrame(rt, gpu.device); drawn++) draw();
  } finally {
    history.dispose();
  }
  return drawn;
}

for (const [name, change] of [
  ['a relit reflection', (frame: ReflectionHistoryFrame) => frame.lighting[0]++],
  ['a moved source the motion cannot follow', (frame: ReflectionHistoryFrame) => frame.epoch[0]++],
] as const)
  test(`#1346: ${name} rests within 20 frames`, () => {
    const drawn = framesToRest(change);
    assert.ok(drawn <= REST_FRAMES, `${drawn} frames drawn`);
  });
