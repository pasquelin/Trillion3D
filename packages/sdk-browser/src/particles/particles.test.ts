// The CPU half of the WebGPU particle step (#420): the words it hands the GPU for a pool, and a
// frame with a pool never held. What the GPU does with them is the measurer's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { fakeDevice, written } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { holdWebgpuFrame, keepWebgpuFrame } from '../webgpu/frame/hold.ts';
import { settledRt } from '../webgpu/frame/hold.fixture.ts';
import { ParticlePool } from '../../../sdk-core/src/fluids/particles.ts';
import { PARTICLES_PASS } from './backend.ts';
import { createWebgpuParticles } from './webgpuParticles.ts';

/** A pool with `n` records staged, record `i` at x = i, and 10 ms to take. */
function staged(n: number, capacity = 1000) {
  const pool = new ParticlePool({ capacity, emitPerFrame: 1000 });
  for (let i = 0; i < n; i++) pool.emit(i, 1, 2, 3, 4, 5, 6);
  pool.advance(0.01);
  return pool;
}

/** An encoder that records its compute passes and their dispatches. */
function computeRecorder() {
  const passes: { label?: string; dispatches: number[] }[] = [];
  const encoder = {
    beginComputePass: ({ label }: GPUComputePassDescriptor) => {
      const pass = { label, dispatches: [] as number[] };
      passes.push(pass);
      return {
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups: (x: number) => void pass.dispatches.push(x),
        end() {},
      };
    },
  } as unknown as GPUCommandEncoder;
  return { encoder, passes };
}

test('WebGPU: one timed pass writes the step words and the staged records, once', async () => {
  const gpu = fakeDevice();
  const particles = createWebgpuParticles(gpu.device, (error) => assert.fail(String(error)));
  const pool = staged(3);
  const { encoder, passes } = computeRecorder();
  assert.equal(particles.run([pool], encoder), 0, 'compiling: the pool waits, its records kept');
  await tick();
  assert.equal(particles.run([pool], encoder), 1);
  assert.deepEqual(passes, [{ label: PARTICLES_PASS, dispatches: [Math.ceil(1000 / 64)] }]);
  const [step, records] = gpu.writes;
  const words = new Uint8Array(written(step)).buffer;
  assert.deepEqual(
    [...new Float32Array(words, 0, 4)],
    [0, Math.fround(-9.81), 0, 0.01].map(Math.fround),
  );
  assert.deepEqual([...new Uint32Array(words, 16, 3)], [0, 3, 1000], 'first slot, count, capacity');
  assert.deepEqual([...written(records)], [...pool.staging.subarray(0, 24)]);
  assert.deepEqual([...written(records)].slice(8, 16), [1, 1, 2, 0, 3, 4, 5, 6]);
  assert.equal(particles.run([pool], encoder), 0, 'nothing staged, no time: no pass');
  assert.equal(gpu.buffers.length, 3, 'state, staging and step made once');
  particles.dispose();
  assert.equal(gpu.destroyed.length, 3);
});

test('WebGPU: a still frame is held until the world has a pool, whose particles move every frame', () => {
  const rt = settledRt(),
    { device } = fakeDevice();
  for (let i = 0; i < 2; i++) {
    rt.run.frame++;
    keepWebgpuFrame(rt);
  }
  assert.equal(holdWebgpuFrame(rt, device), true, 'still, and no pool: held');
  Object.assign(rt.context, { particles: [staged(0)] });
  assert.equal(holdWebgpuFrame(rt, device), false);
  assert.equal(rt.run.frameHeld, false);
});
