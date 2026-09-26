// The CPU half of the particle draw (#755) on both renderers; the GPU's part is the measurer's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { ParticlePool, type ParticlePoolSpec } from '../../../sdk-core/src/fluids/particles.ts';
import { createHostDrawCamera } from '../camera/world.ts';
import { DRAW_FLOATS, writeDrawWords } from './drawWords.ts';
import { PARTICLE_DRAW_PASS as P, createWebgpuParticleDraw } from './webgpuParticleDraw.ts';
import { createWebgpuParticles, encodeParticles } from './webgpuParticles.ts';
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

const view = {} as GPUTextureView,
  kept = () => ({}) as never;
const frame = (encoder: GPUCommandEncoder) => [encoder, view, view, IDENTITY, [0, 0, 0]] as const;

test('WebGPU: one pass, fire then the nearer smoke, each with its blend; none without particles', async () => {
  const gpu = fakeDevice(),
    pools = scene();
  const draw = createWebgpuParticleDraw(gpu.device, kept, (e) => assert.fail(`${e}`));
  await tick();
  const { encoder, log } = renderRecorder();
  assert.equal(draw.draw([], ...frame(encoder)) + draw.draw([pools[2]], ...frame(encoder)), 0);
  assert.deepEqual(log, [], 'no particle alive: no pass, no pixel');
  assert.equal(draw.draw(pools, ...frame(encoder)), 2);
  assert.deepEqual(log, [P, `${P} additive 6 2`, `${P} premultiplied 6 3`], 'far to near');
  const blends = gpu.renderPipelines.map(({ fragment }) => {
    const { color, alpha } = (fragment!.targets as GPUColorTargetState[])[0].blend!;
    return [color.dstFactor, alpha.srcFactor, alpha.dstFactor].join(' ');
  });
  const over = 'one-minus-src-alpha'; // fire keeps the coverage, smoke covers
  assert.deepEqual(blends, ['one zero one', `${over} one ${over}`]);
});

test('WebGPU: a draw that cannot compile is heard, and the next step keeps its pools refused', async () => {
  const heard: unknown[] = [],
    { device } = fakeDevice(),
    [smoke] = scene();
  device.createRenderPipelineAsync = () => Promise.reject(new Error('NO_PIPELINE'));
  const step = createWebgpuParticles(device, (e) => heard.push(e));
  await tick();
  const { encoder, log } = renderRecorder();
  assert.equal(step.draw([smoke], ...frame(encoder)), 0);
  step.run([smoke], encoder);
  assert.deepEqual([heard.length, smoke.refused, log.length], [1, true, 0]);
});

test('WebGPU without the visibility buffer refuses the pools by name, heard once', () => {
  const heard: string[] = [],
    [smoke] = scene(),
    diag = { diagnosticFailure: (code: string, e: Error) => heard.push(`${code} ${e.message}`) };
  const rt = { context: { particles: [smoke] }, vis: { visEnabled: false }, gpu: {}, diag };
  const encode = () => encodeParticles(rt as never, fakeDevice().device, {} as GPUCommandEncoder);
  [0, 1].forEach(encode);
  assert.deepEqual([smoke.refused, heard.length], [true, 1]);
  assert.match(heard[0], /^particles-unavailable PARTICLES_UNSUPPORTED/);
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
  // The depth, then far to near: the lone particle 50 m out, the fire (its alpha kept), the smoke.
  const drawn =
    'DEPTH_BUFFER_BIT NEAREST, ZERO ONE, 6 1, ZERO ONE, 6 3, ONE ONE_MINUS_SRC_ALPHA, 6 4';
  assert.equal(calls.map(({ args }) => args.slice(-2).join(' ')).join(', '), drawn);
  const [, fragment] = ctx.of('shaderSource').find(([, text]) => `${text}`.includes('sceneDepth'))!;
  assert.match(`${fragment}`, /out vec4 untoned;[^]*untoned = vec4\(0\., 0\., 0\., k\);/);
});

test('WebGL2: an earlier GL error never refuses; a depth not copied refuses, the next step too', () => {
  const errors = ['INVALID_OPERATION'], // left by an earlier call, not by the copy
    copy = { fails: false },
    blitFramebuffer = () => void (copy.fails && errors.push('INVALID_OPERATION')),
    getError = () => errors.shift() ?? 'NO_ERROR';
  const { run, particles } = webgl(undefined, { blitFramebuffer, getError }),
    [smoke] = scene();
  smoke.emit(0, 0, -2, 0, 1, 0, 2);
  run([smoke]);
  assert.equal(particles.draw([smoke], createHostDrawCamera(), output), 1);
  copy.fails = true;
  const other = { ...output, framebuffer: {} as WebGLFramebuffer };
  assert.match(
    `${particles.draw([smoke], createHostDrawCamera(), other)}`,
    /PARTICLES_UNSUPPORTED/,
  );
  run([smoke]);
  assert.equal(smoke.refused, true, 'the next step keeps it refused');
});
