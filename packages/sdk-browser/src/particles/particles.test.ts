// The CPU half of the WebGPU particle step (#420): the words it hands the GPU for a pool, and a
// frame with a pool never held. What the GPU does with them is the measurer's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { fakeDevice, written } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { holdWebgpuFrame, keepWebgpuFrame } from '../webgpu/frame/hold.ts';
import { settledRt } from '../webgpu/frame/hold.fixture.ts';
import { ParticlePool } from '../../../sdk-core/src/fluids/particles.ts';
import { PARTICLES_PASS, createWebgpuParticles } from './webgpuParticles.ts';

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
  const pool = new ParticlePool({ capacity: 1000, emitPerFrame: 1000 });
  for (let i = 0; i < 3; i++) pool.emit(i, 1, 2, 3, 4, 5, 6);
  pool.advance(0.01);
  const { encoder, passes } = computeRecorder();
  assert.equal(particles.run([pool], encoder), 0, 'compiling: the pool waits, its records kept');
  await tick();
  assert.equal(particles.run([pool], encoder), 1);
  assert.deepEqual(passes, [{ label: PARTICLES_PASS, dispatches: [1] }], 'the emitted slots only');
  const [step, records] = gpu.writes;
  const words = new Uint8Array(written(step)).buffer;
  assert.deepEqual(
    [...new Float32Array(words, 0, 4)],
    [0, Math.fround(-9.81), 0, 0.01].map(Math.fround),
  );
  assert.deepEqual([...new Uint32Array(words, 16, 3)], [0, 3, 1000], 'first slot, count, capacity');
  assert.deepEqual([...written(records)], [...pool.staging.subarray(0, 24)]);
  assert.equal(particles.run([pool], encoder), 0, 'nothing staged, no time: no pass');
  assert.equal(gpu.buffers.length, 3, 'state, staging and step made once');
  particles.run([], encoder);
  assert.equal(gpu.destroyed.length, 3, 'a pool the world let go of gives its buffers back');
});

test('WebGPU: a step that cannot compile is heard, and its pools stop asking frames', async () => {
  const heard: unknown[] = [],
    { device } = fakeDevice({ compute: false });
  const particles = createWebgpuParticles(device, (error) => heard.push(error));
  const pool = new ParticlePool({ capacity: 8 });
  pool.emit(0, 0, 0, 0, 1, 0, 2);
  await tick();
  assert.equal(particles.run([pool], computeRecorder().encoder), 0);
  assert.deepEqual([heard.length, pool.moving, pool.emit(0, 0, 0, 0, 1, 0, 2)], [1, false, false]);
});

test("WebGPU: a still frame is held until one of the world's pools moves", () => {
  const rt = settledRt(),
    { device } = fakeDevice();
  for (let i = 0; i < 2; i++) {
    rt.run.frame++;
    keepWebgpuFrame(rt);
  }
  assert.equal(holdWebgpuFrame(rt, device), true, 'still, and no pool: held');
  const idle = new ParticlePool({ capacity: 8 });
  Object.assign(rt.context, { particles: [idle] });
  assert.equal(holdWebgpuFrame(rt, device), true, 'an idle pool changes nothing');
  idle.emit(0, 0, 0, 0, 1, 0, 2);
  assert.equal(holdWebgpuFrame(rt, device), false, 'a moving one does');
  assert.equal(rt.run.frameHeld, false);
});
