import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts';
import { createReflectionHistory, type ReflectionHistoryFrame } from './historyRuntime.ts';
import { REFLECTION_HISTORY_WEIGHT, REFLECTION_MOVING_WEIGHT } from './resolveWgsl.ts';

test('first frame rejects history, replay consumes nothing, and a changed source resets the sequence', () => {
  const gpu = fakeDevice();
  const history = createReflectionHistory(gpu.device, 8, 8);
  const current = gpu.device.createTexture({ size: [8, 8], format: 'rgba16float', usage: 1 });
  const frame: ReflectionHistoryFrame = {
    metadata: { depth: current, normal: current, ids: current },
    pages: {} as GPUBuffer,
    motion: {} as GPUBuffer,
    reprojects: false,
    eye: [0, 0, 0],
    epoch: 'initial',
    seed: 1,
    frame: 10,
    camera: IDENTITY_MATRIX4,
  };
  let draws = 0;
  let viewport: number[] = [];
  const encoder = {
    ...gpu.device.createCommandEncoder(),
    beginRenderPass: () => ({
      setViewport: (...values: number[]) => {
        viewport = values;
      },
      setPipeline() {},
      setBindGroup() {},
      draw: () => draws++,
      end() {},
    }),
  } as unknown as GPUCommandEncoder;
  const encode = () =>
    history.encode(
      encoder,
      current.createView(),
      {} as GPURenderPipeline,
      {} as GPUBindGroupLayout,
    );
  const valid = () => gpu.writes.at(-1)!.data[36];
  try {
    history.prepare(frame, IDENTITY_MATRIX4);
    assert.equal(valid(), 0);
    const first = encode();
    assert.equal(draws, 1);
    assert.equal(gpu.textureCopies.length, 3);
    history.prepare(frame, IDENTITY_MATRIX4);
    assert.equal(history.reuse, true);
    assert.equal(encode(), first);
    assert.equal(draws, 1);
    assert.equal(gpu.textureCopies.length, 3);
    frame.frame++;
    history.prepare(frame, IDENTITY_MATRIX4);
    assert.equal(valid(), 1);
    assert.equal(history.rank, 1);
    assert.notEqual(encode(), first);
    assert.equal(draws, 2);
    // Same displayed frame, but a reflected object or residency changed: never reuse its old mean.
    frame.epoch = 'reflected-object-moved';
    history.prepare(frame, IDENTITY_MATRIX4);
    assert.equal(valid(), 0);
    assert.equal(history.rank, 0);
    assert.equal(history.reuse, false);
    encode();
    assert.equal(draws, 3);
    for (let i = 1; i < REFLECTION_HISTORY_WEIGHT; i++) {
      frame.frame++;
      history.prepare(frame, IDENTITY_MATRIX4);
      assert.equal(history.settled, false);
      encode();
    }
    assert.equal(history.settled, true, 'the fixed work window is closed');
    const drawsAtCap = draws;
    frame.frame++;
    history.prepare(frame, IDENTITY_MATRIX4);
    encode();
    assert.equal(draws, drawsAtCap, 'a still source does not refine forever');
    const jittered = [...IDENTITY_MATRIX4];
    jittered[12] = 0.125;
    history.prepare(frame, jittered);
    assert.equal(history.reuse, false, 'new jitter must reproject even after the work window');
    encode();
    for (const extent of [
      [4, 3],
      [8, 8],
    ]) {
      history.prepare(frame, jittered, extent);
      assert.equal(history.reuse, false, 'a drawn extent change invalidates frozen history');
      assert.equal(valid(), 0);
      assert.deepEqual(Array.from(gpu.writes.at(-1)!.data.slice(32, 34)), extent);
      encode();
      assert.deepEqual(viewport, [0, 0, ...extent, 0, 1]);
    }
    const beforeLight = draws;
    frame.epoch = 'light-changed';
    history.prepare(frame, IDENTITY_MATRIX4);
    assert.equal(history.settled, false);
    assert.equal(valid(), 0);
    encode();
    assert.equal(draws, beforeLight + 1, 'light changes resume in the same frame');
  } finally {
    history.dispose();
    history.dispose();
    current.destroy();
  }
  assert.equal(gpu.destroyed.length, 7, 'six owned resources, each destroyed once, plus input');
});

test('resolve uniform refusal releases the complete 32-byte history', () => {
  const gpu = fakeDevice({
    refuse: (descriptor) =>
      descriptor.label === 'Trillion3D reflection resolve view' ? 'throw' : undefined,
  });
  assert.throws(() => createReflectionHistory(gpu.device, 8, 8), /NO_MEMORY/);
  assert.equal(gpu.destroyed.length, 5);
});

test('with live motion a camera move and a moved source keep the history, reprojected', () => {
  const gpu = fakeDevice();
  const history = createReflectionHistory(gpu.device, 8, 8);
  const current = gpu.device.createTexture({ size: [8, 8], format: 'rgba16float', usage: 1 });
  const frame: ReflectionHistoryFrame = {
    metadata: { depth: current, normal: current, ids: current },
    pages: {} as GPUBuffer,
    motion: {} as GPUBuffer,
    reprojects: true,
    eye: [0, 0, 0],
    epoch: 'still',
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
  assert.deepEqual(params(), [1, REFLECTION_HISTORY_WEIGHT, 1], 'still: whole window, motion read');
  step(() => (frame.camera = [...IDENTITY_MATRIX4.slice(0, 12), 0.5, 0, 0, 1]));
  assert.deepEqual(params(), [1, REFLECTION_MOVING_WEIGHT, 1], 'a camera move keeps it');
  step(() => (frame.epoch = 'gear-turned'));
  assert.deepEqual(params(), [1, REFLECTION_MOVING_WEIGHT, 1], 'a moved source keeps it');
  assert.equal(history.reuse, false);
  frame.reprojects = false;
  step(() => (frame.epoch = 'gear-turned-again'));
  assert.equal(params()[0], 0, 'without motion to follow, a moved source resets it');
  history.dispose();
  current.destroy();
});
