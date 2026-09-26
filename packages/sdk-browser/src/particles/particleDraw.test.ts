// The CPU half of the particle draw (#755) on both renderers: the order and words each pool is
// drawn with, the blend each draw is given, nothing drawn without a live particle, and a refusal
// by name where a draw cannot be made. What the GPU makes of them is the measurer's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { ParticlePool, type ParticlePoolSpec } from '../../../sdk-core/src/fluids/particles.ts';
import { createHostDrawCamera } from '../camera/world.ts';
import { DRAW_FLOATS, drawOrder, writeDrawWords } from './drawWords.ts';
import { PARTICLE_DRAW_PASS, createWebgpuParticleDraw } from './webgpuParticleDraw.ts';
import { webgl } from './stepModels.fixture.ts';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Fire 20 m ahead with two particles, smoke 2 m ahead with three, and a pool never emitted
 *  into, 50 m ahead; the records are stepped (`flush`), as the step does before the draw. */
function scene() {
  const pool = (z: number, n: number, spec: Partial<ParticlePoolSpec> = {}) => {
    const made = new ParticlePool({ capacity: 8, origin: [0, 0, z], ...spec });
    for (let i = 0; i < n; i++) made.emit(0, 0, z, 0, 1, 0, 2);
    made.flush();
    return made;
  };
  return [pool(-2, 3, { blend: 'premultiplied' }), pool(-20, 2), pool(-50, 0)];
}

test('pools with live particles are drawn far to near by origin, into the same list', () => {
  const [smoke, fire, idle] = scene(),
    into: ParticlePool[] = [];
  assert.equal(drawOrder([smoke, idle, fire], [0, 0, 0], into), into);
  assert.deepEqual(into, [fire, smoke], 'the idle pool is left out');
  assert.deepEqual(drawOrder([smoke, fire], [0, 0, -30], into), [smoke, fire], 'seen from past');
});

test('a pool 10 km out is drawn from its origin: the words hold to the millimetre', () => {
  const pool = new ParticlePool({ capacity: 8, origin: [1e4, 0, 1e4], size: 0.5 }),
    eye = [1e4 + 0.001, 0, 1e4],
    view = [...IDENTITY.slice(0, 12), -eye[0], -eye[1], -eye[2], 1],
    words = new Float32Array(DRAW_FLOATS);
  writeDrawWords(words, pool, view, eye);
  assert.deepEqual([...words.subarray(12, 16)], [Math.fround(-0.001), 0, 0, 1], 'origin to eye');
  assert.deepEqual([...words.subarray(28, 31)], [Math.fround(0.001), 0, 0], 'and back');
  assert.deepEqual([...words.subarray(32, 36)], [Math.fround(0.001), 0, 0, 0.5], 'eye, size');
  assert.deepEqual([...words.subarray(36, 41)], [1, 0.8, 0.5, 1, 0.5].map(Math.fround));
});

/** An encoder that records its render passes and each draw's pipeline, vertices and instances. */
function renderRecorder() {
  const passes: { label?: string; draws: unknown[][] }[] = [];
  const encoder = {
    beginRenderPass: ({ label }: GPURenderPassDescriptor) => {
      const pass = { label, draws: [] as unknown[][] };
      passes.push(pass);
      let pipeline: GPURenderPipeline;
      return {
        setPipeline: (set: GPURenderPipeline) => void (pipeline = set),
        setBindGroup() {},
        draw: (vertices: number, instances: number) =>
          void pass.draws.push([pipeline.label, vertices, instances]),
        end() {},
      };
    },
  } as unknown as GPUCommandEncoder;
  return { encoder, passes };
}

test('WebGPU: one pass, fire then the nearer smoke, each with its blend; none without particles', async () => {
  const gpu = fakeDevice(),
    pools = scene(),
    state = {} as GPUBuffer;
  const draw = createWebgpuParticleDraw(
    gpu.device,
    () => state,
    (e) => assert.fail(String(e)),
  );
  await tick();
  const { encoder, passes } = renderRecorder(),
    frame = [encoder, {}, {}, IDENTITY, [0, 0, 0]] as const;
  assert.equal(draw.draw([], ...frame), 0);
  assert.equal(draw.draw([pools[2]], ...frame), 0);
  assert.deepEqual(passes, [], 'no particle alive: no pass, no pixel');
  assert.equal(draw.draw(pools, ...frame), 2);
  const [fire, smoke] = ['additive', 'premultiplied'].map(
    (blend) => `${PARTICLE_DRAW_PASS} ${blend}`,
  );
  assert.deepEqual(passes, [
    {
      label: PARTICLE_DRAW_PASS,
      draws: [
        [fire, 6, 2],
        [smoke, 6, 3],
      ],
    },
  ]);
  const blendOf = (label: string) => {
    const { fragment } = gpu.renderPipelines.find((made) => made.label === label)!;
    return [fragment!.targets[0]!.blend!.color.dstFactor, fragment!.constants!.premultiplied];
  };
  assert.deepEqual(
    [blendOf(fire), blendOf(smoke)],
    [
      ['one', 0],
      ['one-minus-src-alpha', 1],
    ],
  );
});

test('WebGPU: a draw that cannot compile is heard, and refuses its pools', async () => {
  const heard: unknown[] = [],
    { device } = fakeDevice(),
    [smoke] = scene();
  device.createRenderPipelineAsync = () => Promise.reject(new Error('NO_PIPELINE'));
  const draw = createWebgpuParticleDraw(
    device,
    () => ({}) as GPUBuffer,
    (e) => heard.push(e),
  );
  await tick();
  const { encoder, passes } = renderRecorder();
  assert.equal(
    draw.draw([smoke], encoder, {} as GPUTextureView, {} as GPUTextureView, IDENTITY, [0, 0, 0]),
    0,
  );
  assert.deepEqual([heard.length, smoke.refused, passes.length], [1, true, 0]);
});

const output = { framebuffer: null, width: 8, height: 4, toneMapped: true };

test("WebGL2: the frame's depth is copied, then fire and the nearer smoke, each with its blend", () => {
  const { ctx, run, particles } = webgl(),
    camera = createHostDrawCamera(),
    pools = scene();
  const calls = (from: number, name: string) => ctx.of(name).slice(from);
  assert.equal(particles.draw([], camera, output), 0);
  assert.deepEqual(ctx.of('blitFramebuffer'), [], 'no particle: nothing copied, nothing drawn');
  for (const pool of pools) pool.emit(0, 0, pool.origin[2], 0, 1, 0, 2);
  run(pools);
  const [blits, blends, draws] = ['blitFramebuffer', 'blendFunc', 'drawArraysInstanced'].map(
    (name) => ctx.of(name).length,
  );
  assert.equal(particles.draw(pools, camera, output), 3);
  assert.deepEqual(calls(blits, 'blitFramebuffer'), [
    [0, 0, 8, 4, 0, 0, 8, 4, 'DEPTH_BUFFER_BIT', 'NEAREST'],
  ]);
  assert.deepEqual(calls(blends, 'blendFunc'), [
    ['ONE', 'ONE'],
    ['ONE', 'ONE'],
    ['ONE', 'ONE_MINUS_SRC_ALPHA'],
  ]);
  assert.deepEqual(
    calls(draws, 'drawArraysInstanced').map((args) => args.at(-1)),
    [1, 3, 4],
    'far to near: the lone particle 50 m out, the fire, the smoke',
  );
});

test("WebGL2: a context that cannot copy the frame's depth refuses the pools by name", () => {
  const { run, particles } = webgl(undefined, { getError: () => 'INVALID_OPERATION' }),
    [smoke] = scene();
  smoke.emit(0, 0, -2, 0, 1, 0, 2);
  run([smoke]);
  assert.throws(
    () => particles.draw([smoke], createHostDrawCamera(), output),
    /^Error: PARTICLES_UNSUPPORTED/,
  );
  assert.deepEqual([smoke.refused, smoke.emit(0, 0, 0, 0, 1, 0, 2)], [true, false]);
});
