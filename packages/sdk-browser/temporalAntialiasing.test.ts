import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemporalAntialiasing } from './temporalAntialiasing.ts';

/** The strict minimum of a device: every creation answers an inert object. */
function device() {
  Object.assign(globalThis, {
    GPUBufferUsage: { UNIFORM: 64, COPY_DST: 8, STORAGE: 128 },
    GPUShaderStage: { FRAGMENT: 2 },
  });
  const inert = () => ({ destroy() {} }) as never;
  return {
    createBuffer: inert,
    createBindGroupLayout: inert,
    createPipelineLayout: inert,
    createSampler: inert,
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createRenderPipelineAsync: async () => ({}),
    queue: { writeBuffer() {} },
  } as unknown as GPUDevice;
}

// A convergence frame replays the last ordinary frame: every field the checkpoint keeps comes
// back, the sampled rank among them, so it draws the same lights and makes the same image.
test('the checkpoint keeps the frame fields the replay restores, sampled rank included', async () => {
  const temporal = await createTemporalAntialiasing(device(), []);
  const { frame } = temporal;
  Object.assign(frame, {
    sample: 3,
    stillFrames: 0,
    hasHistory: true,
    sceneSeen: 7,
    sampledRank: 42,
  });
  frame.previousViewProjection.fill(0.5);
  temporal.checkpoint(false);
  Object.assign(frame, {
    sample: 4,
    stillFrames: 1,
    hasHistory: false,
    sceneSeen: 8,
    sampledRank: 0,
  });
  frame.previousViewProjection.fill(0);
  assert.equal(temporal.replay(), false, 'the replayed stillness is the checkpointed one');
  assert.deepEqual(
    [frame.sample, frame.stillFrames, frame.hasHistory, frame.sceneSeen, frame.sampledRank],
    [3, 0, true, 7, 42],
  );
  assert.ok(frame.previousViewProjection.every((value) => value === 0.5));
  temporal.dispose();
});
