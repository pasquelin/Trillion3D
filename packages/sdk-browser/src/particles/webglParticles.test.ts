// The CPU half of the WebGL2 particle step (#759): the texels, uniforms and targets it hands its
// GPU for a pool, what they come to against the WebGPU step's, and its refusal without a
// half-float target. What the GPU does with them is the measurer's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createTestContext } from '../webgl/core/testContext.fixture.ts';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { ParticlePool, type ParticlePoolSpec } from '../../../sdk-core/src/fluids/particles.ts';
import { createWebglParticles } from './webglParticles.ts';
import { createWebgpuParticles } from './webgpuParticles.ts';
import { webglModel, webgpuModel } from './stepModels.fixture.ts';

const DT = 1 / 64; // exact in a half float: both steps age a particle alike

/** A context with half-float targets, its WebGL2 step, and what one `run` handed the GPU. */
function webgl(extensions: object | null = {}) {
  const ctx = createTestContext({ answers: { getExtension: () => extensions } });
  const particles = createWebglParticles(ctx.gl);
  const run = (pools: ParticlePool[]) => {
    const from = ctx.calls.length,
      draws = particles.run(pools),
      calls = ctx.calls.slice(from),
      of = (name: string) => calls.filter((call) => call.name === name).map(({ args }) => args);
    return { draws, of };
  };
  return { ctx, particles, run };
}

test('WebGL2: the records land as float texels, only emitted rows are drawn, the targets swap', () => {
  const { ctx, run } = webgl();
  const pool = new ParticlePool({ capacity: 2000, emitPerFrame: 1000 });
  for (let i = 0; i < 600; i++) pool.emit(i, 1, 2, 3, 4, 5, 6);
  pool.advance(0.01);
  const first = run([pool]);
  assert.equal(first.draws, 1);
  // 512 records a row, two texels each: one whole row, then 88 records on the second.
  assert.deepEqual(
    first.of('texSubImage2D').map(([, , x, y, w, h, , , , offset]) => [x, y, w, h, offset]),
    [
      [0, 0, 1024, 1, 0],
      [0, 1, 176, 1, 512 * 8],
    ],
  );
  assert.equal(first.of('texSubImage2D')[0][8], pool.staging, 'straight from the staging');
  assert.deepEqual(first.of('uniform4f')[0].slice(1), [0, Math.fround(-9.81), 0, 0.01]);
  assert.deepEqual(first.of('uniform3i')[0].slice(1), [0, 600, 2000], 'first slot, count, ring');
  assert.deepEqual(first.of('viewport').at(-1), [0, 0, 1024, 2], '600 slots: 2 of 4 rows');
  const into = (step: typeof first) => step.of('bindFramebuffer').findLast(([, fb]) => fb)?.[1];
  pool.advance(0.01);
  const second = run([pool]);
  assert.notEqual(into(second), into(first), 'the other target is written');
  assert.deepEqual(second.of('uniform3i')[0].slice(1), [600, 0, 2000]);
  assert.equal(second.of('texSubImage2D').length, 0, 'nothing staged, nothing uploaded');
  assert.equal(run([pool]).draws, 0, 'no time and no record: no draw');
  assert.equal(ctx.of('createFramebuffer').length, 2, 'two targets, made once');
  run([]);
  assert.equal(ctx.of('deleteFramebuffer').length, 2, 'a pool the world let go of frees them');
});

test('WebGL2 without a half-float colour target refuses the pools by name', () => {
  const { run } = webgl(null);
  const pool = new ParticlePool({ capacity: 8 });
  pool.emit(0, 0, 0, 0, 1, 0, 2);
  assert.throws(() => run([pool]), /^Error: PARTICLES_UNSUPPORTED/);
  assert.deepEqual([pool.moving, pool.emit(0, 0, 0, 0, 1, 0, 2)], [false, false], 'refused');
});

/** Emits the same particles into every pool: speeds up to 5 m/s, lives of 1/4 to 2 s. */
function emitReference(pools: ParticlePool[], frame: number) {
  for (let n = 0; n < 5; n++) {
    const s = Math.sin(frame * 7 + n * 13);
    for (const pool of pools)
      pool.emit(n, 1, -n, 5 * s, 4 - n, 3 * s * s, 0.25 * (1 + n + (frame % 4)));
  }
}

test('WebGL2 and WebGPU step a reference emission alike, within half-float tolerance', async () => {
  const spec: ParticlePoolSpec = { capacity: 300, emitPerFrame: 8 },
    frames = 64;
  const gpu = fakeDevice(),
    stepGpu = createWebgpuParticles(gpu.device, (error) => assert.fail(String(error)));
  await tick();
  const { run } = webgl(),
    pools = [new ParticlePool(spec), new ParticlePool(spec)];
  const models = { gpu: webgpuModel(spec.capacity), gl: webglModel(spec.capacity) };
  let groups = 0;
  const pass = { setPipeline() {}, setBindGroup() {}, end() {} },
    dispatchWorkgroups = (x: number) => void (groups = x),
    encoder = { beginComputePass: () => ({ ...pass, dispatchWorkgroups }) };
  for (let frame = 0; frame < frames; frame++) {
    emitReference(pools, frame);
    for (const pool of pools) pool.advance(DT);
    const from = gpu.writes.length;
    stepGpu.run([pools[0]], encoder as unknown as GPUCommandEncoder);
    models.gpu.step(gpu.writes[from], gpu.writes[from + 1], groups);
    models.gl.step(run([pools[1]]).of);
  }
  let moved = 0;
  for (let i = 0; i < spec.capacity; i++) {
    const [ours, theirs] = [models.gl.particle(i), models.gpu.particle(i)];
    if (theirs[3] > 0) moved++;
    ours.forEach((value, k) => {
      const tolerance = frames * 2 ** -11 * Math.max(1, Math.abs(theirs[k]));
      assert.ok(
        Math.abs(value - theirs[k]) <= tolerance,
        `slot ${i}[${k}]: ${value} vs ${theirs[k]}`,
      );
    });
  }
  assert.ok(moved > 200, `${moved} particles stepped`);
});

test('WebGL2: a 1 mm step holds ten kilometres from the world origin', () => {
  const { run } = webgl(),
    model = webglModel(8);
  const pool = new ParticlePool({ capacity: 8, acceleration: [0, 0, 0], origin: [1e4, 0, 1e4] });
  pool.emit(1e4 + 0.25, 2, 1e4, 0.064, 0, 0, 4); // 1 mm each 1/64 s
  let x = 0.25;
  for (let frame = 0; frame < 10; frame++) {
    pool.advance(DT);
    model.step(run([pool]).of);
    const moved = model.particle(0)[0] - x;
    assert.ok(Math.abs(moved - 0.001) <= 2 ** -13, `step ${frame}: ${moved * 1000} mm`);
    x += moved;
  }
});
