import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts';
import { createReflectionHistory } from './historyRuntime.ts';
import {
  REFLECTION_LIGHTING_VERSIONS,
  REFLECTION_PLACEMENT_VERSIONS,
  type ReflectionHistoryFrame,
} from './historyFrame.ts';
import {
  REFLECTION_CHANGE_KEPT,
  REFLECTION_MOVING_KEPT,
  REFLECTION_STILL_FRAMES,
} from './resolveWgsl.ts';

// The last depth and identifiers are the reflection source's (`source.ts`).
const kept = { depth: {} as GPUTextureView, ids: {} as GPUTextureView };

test('with live motion a camera move and a moved source keep the history, reprojected', () => {
  const gpu = fakeDevice();
  const history = createReflectionHistory(gpu.device, 8, 8, kept);
  const current = gpu.device.createTexture({ size: [8, 8], format: 'rgba16float', usage: 1 });
  const frame: ReflectionHistoryFrame = {
    metadata: { depth: current, normal: current, ids: current },
    ids: {} as GPUTextureView,
    pages: {} as GPUBuffer,
    motion: {} as GPUBuffer,
    eye: [0, 0, 0],
    epoch: new Float64Array(REFLECTION_PLACEMENT_VERSIONS),
    lighting: new Float64Array(REFLECTION_LIGHTING_VERSIONS),
    seed: 0,
    frame: 0,
    camera: IDENTITY_MATRIX4,
  };
  const encoder = {
    ...gpu.device.createCommandEncoder(),
    beginRenderPass: () => ({
      setViewport() {},
      setPipeline() {},
      setBindGroup() {},
      draw() {},
      end() {},
    }),
  } as unknown as GPUCommandEncoder;
  const params = () => Array.from(gpu.writes.at(-1)!.data.slice(36, 39));
  const step = (change: () => void) => {
    frame.frame++;
    change();
    history.prepare(frame, frame.camera);
    history.encode(
      encoder,
      current.createView(),
      {} as GPURenderPipeline,
      {} as GPUBindGroupLayout,
    );
  };
  step(() => {});
  step(() => {});
  assert.deepEqual(params(), [1, REFLECTION_STILL_FRAMES, 1], 'still: whole window, motion read');
  step(() => (frame.camera = [...IDENTITY_MATRIX4.slice(0, 12), 0.5, 0, 0, 1]));
  assert.deepEqual(params(), [1, REFLECTION_MOVING_KEPT, 1], 'a camera move keeps it');
  step(() => frame.epoch[0]++);
  assert.deepEqual(params(), [1, REFLECTION_MOVING_KEPT, 1], 'a moved source keeps it');
  assert.equal(history.reuse, false);
  // #1342: a relit source kept its old reflections; no motion brings old lighting to the new one.
  step(() => frame.lighting[0]++);
  assert.equal(params()[0], 0, 'a lighting change resets it, live motion or not');
  assert.equal(history.rank, 0);
  step(() => {});
  frame.motion = frame.pages;
  step(() => frame.epoch[0]++);
  assert.deepEqual(
    params(),
    [1, REFLECTION_CHANGE_KEPT, 0],
    'without motion to follow, a moved source keeps it at the change cap (#33)',
  );
  history.dispose();
  current.destroy();
});
