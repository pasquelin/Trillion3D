// The CPU half of the particle draw (#755) on both renderers; the GPU's part is the measurer's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { ParticlePool, type ParticlePoolSpec } from '../../../sdk-core/src/fluids/particles.ts';
import { createHostDrawCamera } from '../camera/world.ts';
import { DRAW_FLOATS, writeDrawWords } from './drawWords.ts';
import { PARTICLE_DRAW_PASS, createWebgpuParticleDraw } from './webgpuParticleDraw.ts';
import { webgl } from './stepModels.fixture.ts';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Smoke 2 m ahead with three stepped particles, fire 20 m ahead with two, an empty pool at 50 m. */
function scene() {
  const pool = (z: number, n: number, spec: Partial<ParticlePoolSpec> = {}) => {
    const made = new ParticlePool({ capacity: 8, origin: [0, 0, z], ...spec });
    for (let i = 0; i < n; i++) made.emit(0, 0, z, 0, 1, 0, 2);
    made.flush();
    return made;
  };
  return [pool(-2, 3, { blend: 'premultiplied' }), pool(-20, 2), pool(-50, 0)];
}

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

/** An encoder that logs its render passes, and each draw's pipeline, vertices and instances. */
function renderRecorder() {
  const log: string[] = [];
  const beginRenderPass = ({ label }: GPURenderPassDescriptor) => {
    let pipeline: GPURenderPipeline;
    log.push(`${label}`);
    return {
      setPipeline: (set: GPURenderPipeline) => void (pipeline = set),
      setBindGroup() {},
      draw: (...counts: number[]) => void log.push([pipeline.label, ...counts].join(' ')),
      end() {},
    };
  };
  return { encoder: { beginRenderPass } as unknown as GPUCommandEncoder, log };
}

const P = PARTICLE_DRAW_PASS,
  view = {} as GPUTextureView;
const frame = (encoder: GPUCommandEncoder) => [encoder, view, view, IDENTITY, [0, 0, 0]] as const;

test('WebGPU: one pass, fire then the nearer smoke, each with its blend; none without particles', async () => {
  const gpu = fakeDevice(),
    pools = scene();
  const draw = createWebgpuParticleDraw(
    gpu.device,
    () => ({}) as GPUBuffer,
    (e) => assert.fail(`${e}`),
  );
  await tick();
  const { encoder, log } = renderRecorder();
  assert.equal(draw.draw([], ...frame(encoder)) + draw.draw([pools[2]], ...frame(encoder)), 0);
  assert.deepEqual(log, [], 'no particle alive: no pass, no pixel');
  assert.equal(draw.draw(pools, ...frame(encoder)), 2);
  assert.deepEqual(log, [P, `${P} additive 6 2`, `${P} premultiplied 6 3`], 'far to near');
  const blends = gpu.renderPipelines.map(({ label, fragment }) => {
    const [{ blend }] = [...fragment!.targets] as GPUColorTargetState[];
    return `${label} ${blend!.color.dstFactor} ${fragment!.constants!.premultiplied}`;
  });
  assert.deepEqual(blends, [`${P} additive one 0`, `${P} premultiplied one-minus-src-alpha 1`]);
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
  const { encoder, log } = renderRecorder();
  assert.equal(draw.draw([smoke], ...frame(encoder)), 0);
  assert.deepEqual([heard.length, smoke.refused, log.length], [1, true, 0]);
});

const output = { framebuffer: null, width: 8, height: 4, toneMapped: true };

test("WebGL2: the frame's depth is copied, then the pools far to near, each with its blend", () => {
  const { ctx, run, particles } = webgl(),
    pools = scene();
  assert.equal(particles.draw([], createHostDrawCamera(), output), 0);
  assert.deepEqual(ctx.of('blitFramebuffer'), [], 'no particle: nothing copied, nothing drawn');
  for (const pool of pools) pool.emit(0, 0, pool.origin[2], 0, 1, 0, 2);
  run(pools);
  const from = ctx.calls.length;
  assert.equal(particles.draw(pools, createHostDrawCamera(), output), 3);
  const calls = ctx.calls.slice(from).filter(({ name }) => /^(blit|blendFunc|drawArr)/.test(name));
  assert.deepEqual(
    calls.map(({ args }) => args.slice(-3).join(' ')),
    [
      '4 DEPTH_BUFFER_BIT NEAREST', // the whole 8 × 4 frame,
      'ONE ONE',
      '0 6 1', // the lone particle 50 m out,
      'ONE ONE',
      '0 6 3', // the fire,
      'ONE ONE_MINUS_SRC_ALPHA',
      '0 6 4', // then the smoke
    ],
  );
});

test("WebGL2: a context that cannot copy the frame's depth refuses the pools by name", () => {
  const { run, particles } = webgl(undefined, { getError: () => 'INVALID_OPERATION' }),
    [smoke] = scene();
  smoke.emit(0, 0, -2, 0, 1, 0, 2);
  run([smoke]);
  const drawn = () => particles.draw([smoke], createHostDrawCamera(), output);
  assert.throws(drawn, /^Error: PARTICLES_UNSUPPORTED/);
  assert.deepEqual([smoke.refused, smoke.emit(0, 0, 0, 0, 1, 0, 2)], [true, false]);
});
