// The CPU half of the WebGPU particle draw (#755); the GPU's part is the recette's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { ParticlePool, type ParticlePoolSpec } from '../../../sdk-core/src/fluids/particles.ts';
import { DRAW_FLOATS, writeDrawWords } from './drawWords.ts';
import { PARTICLE_DRAW_PASS as P, createWebgpuParticleDraw } from './webgpuParticleDraw.ts';
import { encodeParticles } from './webgpuParticles.ts';

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
  // Origin to eye and back, eye from the origin, size, colour, softness: each to the millimetre.
  const got = [12, 13, 15, 28, 32, 35, 36, 37, 38, 39, 40].map((i) => words[i]);
  assert.deepEqual(got, [-0.001, 0, 1, 0.001, 0.001, 0.5, 1, 0.8, 0.5, 1, 0.5].map(Math.fround));
});

/** An encoder that logs its render passes, and each draw's pipeline, vertices and instances. */
function renderRecorder() {
  const log: string[] = [],
    attached: unknown[][] = [];
  const beginRenderPass = ({ label, colorAttachments }: GPURenderPassDescriptor) => {
    let pipeline: GPURenderPipeline;
    log.push(`${label}`);
    attached.push([...colorAttachments].map((attachment) => attachment?.view));
    return {
      setPipeline: (set: GPURenderPipeline) => void (pipeline = set),
      setBindGroup() {},
      setViewport() {},
      draw: (...counts: number[]) => void log.push([pipeline.label, ...counts].join(' ')),
      end() {},
    };
  };
  return { encoder: { beginRenderPass } as unknown as GPUCommandEncoder, log, attached };
}

const view = {} as GPUTextureView,
  reactive = { label: 'reactive' } as unknown as GPUTextureView,
  kept = () => ({}) as never;
const frame = (encoder: GPUCommandEncoder) =>
  [encoder, view, reactive, view, [8, 8], IDENTITY, [0, 0, 0]] as const;

test('WebGPU: one pass, fire then the nearer smoke, each with its blend; none without particles', async () => {
  const gpu = fakeDevice(),
    pools = scene();
  const draw = createWebgpuParticleDraw(gpu.device, kept, (e) => assert.fail(`${e}`));
  await tick();
  const { encoder, log, attached } = renderRecorder();
  assert.equal(draw.draw([], ...frame(encoder)) + draw.draw([pools[2]], ...frame(encoder)), 0);
  assert.deepEqual(log, [], 'no particle alive: no pass, no pixel');
  assert.equal(draw.draw(pools, ...frame(encoder)), 2);
  assert.deepEqual(log, [P, `${P} additive 6 2`, `${P} premultiplied 6 3`], 'far to near');
  // The lit image, then the reactive value their coverage is written in (#833).
  assert.deepEqual(attached, [[view, reactive]]);
  const blends = gpu.renderPipelines.map(({ fragment }) => {
    const { color, alpha } = (fragment!.targets as GPUColorTargetState[])[0].blend!;
    return [color.dstFactor, alpha.srcFactor, alpha.dstFactor].join(' ');
  });
  const over = 'one-minus-src-alpha'; // fire keeps the coverage, smoke covers
  assert.deepEqual(blends, ['one zero one', `${over} one ${over}`]);
});

test('WebGPU without the visibility buffer refuses the pools by name, heard once, and frees the step', () => {
  const [heard, [smoke]] = [[] as string[], scene()],
    particlesRefused = (reason: string) => void heard.push(reason),
    freed: string[] = [],
    gpu = { particles: { dispose: () => void freed.push('step') } as object | undefined },
    rt = { context: { particles: [smoke], particlesRefused }, vis: { visEnabled: false }, gpu };
  const encode = () => encodeParticles(rt as never, fakeDevice().device, {} as GPUCommandEncoder);
  [0, 1].forEach(encode);
  assert.deepEqual(
    [smoke.refused, heard.length, freed, gpu.particles],
    [true, 1, ['step'], undefined],
  );
  assert.match(heard[0], /^PARTICLES_UNSUPPORTED: particles draw on the visibility buffer/);
});

test('WebGPU: the pools step once a frame, on the main view; another view draws them as they are', () => {
  let steps = 0;
  const [smoke] = scene(),
    main = {},
    views = { main, active: {} },
    gpu = { particles: { run: () => (steps++, 1) } },
    rt = { context: { particles: [smoke] }, vis: { visEnabled: true }, gpu, run: {}, views };
  const encode = () => encodeParticles(rt as never, fakeDevice().device, {} as GPUCommandEncoder);
  encode();
  assert.equal(steps, 0, 'another view steps nothing');
  views.active = main;
  encode();
  assert.equal(steps, 1);
});
