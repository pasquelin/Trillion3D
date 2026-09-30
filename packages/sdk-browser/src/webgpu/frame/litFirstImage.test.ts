// #1362: the first image arrives lit. The lit program compiles during prepare, before any frame; a
// scene with no transparent object compiles no blend program; prepare's pipelines compile together,
// off the thread; the unlit view keeps what a surface emits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeferredLighting } from '../../lighting/deferred/deferred.ts';
import { UNLIT_LIGHTING_SHADER } from '../../lighting/deferred/shaders.ts';
import { createWebgpuBlendPipelines } from '../blend/pipelines.ts';
import { declaredBlendModes } from '../blend/stagePipelines.ts';
import { createWebgpuPagesPipelines } from '../pages/prepare/pipelines.ts';
import { litPrograms } from '../pages/prepare/contractLight.ts';
import { validated } from '../../gpu/core/errorScope.ts';
import { createLightRowMap, lightRowMapPipeline } from '../../gpu/draw/lightRows.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { settledRt, surface, view } from './hold.fixture.ts';
import { BLEND_SHADER } from '../../gpu/core/shaderTexts.fixture.ts';

/** A fake device that names every render pipeline compiled off the thread, by its module. */
function recordingDevice() {
  const fake = fakeDevice();
  const compiled: string[] = [];
  const compile = fake.device.createRenderPipelineAsync.bind(fake.device);
  fake.device.createRenderPipelineAsync = async (descriptor) => {
    compiled.push(descriptor.fragment?.module.label ?? '');
    return compile(descriptor);
  };
  return { ...fake, compiled };
}

test('the lit program starts compiling with prepare, before the first frame asks for it', async () => {
  const { device, compiled } = recordingDevice();
  const lighting = await createDeferredLighting(device, undefined, undefined, {
    precompile: true,
    bounce: false,
  });
  // No frame has asked anything: prepare alone started and awaits them.
  await lighting.litReady;
  assert.ok(
    compiled.some((label) => /^DIRECT_NARROW/.test(label)),
    'the narrow program',
  );
  assert.ok(
    compiled.some((label) => /^DIRECT_(?!NARROW)/.test(label)),
    'and its wide twin',
  );
  assert.ok(!compiled.some((label) => label.startsWith('BOUNCE')), 'no bounce unless wanted');
  const direct = { lights: {} as GPUBuffer };
  assert.equal(lighting.awaited(direct), undefined, 'the first frame waits for nothing');
  lighting.bind(surface, view(), view(), true, direct);
  assert.equal(lighting.usesContract, true, 'the first frame is lit');
});

test('an unshadowed program that fails holds the frame on its shadowed twin, never unlit', async () => {
  const { device } = fakeDevice();
  let release!: () => void;
  const gate = new Promise<void>((done) => (release = done));
  const compile = device.createRenderPipelineAsync.bind(device);
  device.createRenderPipelineAsync = async (descriptor) => {
    const label = descriptor.fragment?.module.label ?? '';
    if (label.includes('_UNSHADOWED')) throw new Error('refused');
    if (label.startsWith('DIRECT')) await gate;
    return compile(descriptor);
  };
  let redrawn = 0;
  const lighting = await createDeferredLighting(device, () => redrawn++);
  const direct = { lights: {} as GPUBuffer, unshadowed: true };
  const asked = lighting.awaited(direct);
  assert.ok(asked, 'the frame waits for its program');
  await asked.catch(() => undefined);
  await new Promise((done) => setImmediate(done));
  const twin = lighting.awaited(direct);
  assert.ok(twin, 'the failed program hands the frame to its twin');
  release();
  await twin;
  assert.equal(redrawn, 1, 'the twin landing redraws the frame');
  assert.equal(lighting.awaited(direct), undefined);
  lighting.bind(surface, view(), view(), true, direct, () => {});
  assert.equal(lighting.usesContract, true, 'the frame is lit');
});

test('prepare precompiles the lit program only for a lit view, and says a failure either way', () => {
  const rt = Object.assign(settledRt(), { diag: { diagnosticFailure: () => {} } });
  Object.assign(rt.bounce, { wanted: true });
  assert.deepEqual([litPrograms(rt).precompile, litPrograms(rt).bounce], [true, true]);
  Object.assign(rt.lights, { store: { count: 0, unlit: true } });
  assert.equal(litPrograms(rt).precompile, false, 'an unlit view compiles it only when asked');
  assert.equal(typeof litPrograms(rt).onFailure, 'function');
});

test('a scene with no transparent object compiles no blend program', async () => {
  const blend = fakeDevice();
  await createWebgpuBlendPipelines(blend.device, []);
  assert.deepEqual(blend.renderPipelines, [], 'no forward material pipeline');
  const fallback = fakeDevice();
  const { pipelineBlend } = await createWebgpuPagesPipelines(fallback.device, 256);
  await pipelineBlend.precompile(declaredBlendModes([]));
  assert.equal(fallback.renderPipelines.length, 3, 'the three opaque culls alone');
  const blended = fallback.renderPipelines.filter((made) =>
    [...(made.fragment?.targets ?? [])].some((target) => target?.blend),
  );
  assert.deepEqual(blended, []);
});

test('prepare creates its pipelines together, off the thread, never one after another', async () => {
  const { device } = fakeDevice();
  let started = 0,
    release!: () => void;
  const gate = new Promise<void>((done) => (release = done));
  const compile = device.createRenderPipelineAsync.bind(device);
  device.createRenderPipelineAsync = async (descriptor) => {
    started++;
    await gate;
    return compile(descriptor);
  };
  const made = createWebgpuPagesPipelines(device, 256);
  await new Promise((done) => setImmediate(done));
  assert.equal(started, 3, 'all three compile before any has landed');
  release();
  assert.ok((await made).pipelineNone);
});

test("the light cut's row map compiles off the thread at prepare, never at the first light cut", async () => {
  const { device } = fakeDevice();
  let onThread = 0;
  const compile = device.createComputePipeline.bind(device);
  device.createComputePipeline = (descriptor) => (onThread++, compile(descriptor));
  // What `../pages/prepare/lights.ts` starts for a scene the GPU draws.
  await lightRowMapPipeline(device).pipeline.prepare();
  const map = createLightRowMap(device, device.createBuffer({ size: 64, usage: 0 }), 16, []);
  const set: string[] = [];
  const pass = {
    setPipeline: (pipeline: { entryPoint: string }) => set.push(pipeline.entryPoint),
    setBindGroup() {},
    dispatchWorkgroups() {},
  } as unknown as GPUComputePassEncoder;
  map.encode(pass, 4);
  assert.deepEqual(set, ['mapRows'], 'the first light cut maps its rows');
  assert.equal(onThread, 0, 'with the pipeline prepare compiled');
});

test('a pipeline the device refuses off the thread is a refusal, not a throw', async () => {
  class GPUPipelineError extends Error {}
  Object.assign(globalThis, { GPUPipelineError });
  const { device } = fakeDevice();
  const refused = await validated(device, async () => {
    throw new GPUPipelineError('refused');
  });
  assert.equal(refused, undefined);
  await assert.rejects(validated(device, async () => Promise.reject(new Error('other'))));
});

test('the unlit view keeps what a surface emits, opaque and transparent alike', () => {
  assert.match(UNLIT_LIGHTING_SHADER, /baseMetal,coord,0\)\.rgb\+textureLoad\(emissiveAo/);
  assert.match(BLEND_SHADER, /\}else\{rgb\+=s\.emissive;\}\s*let r=displayRoute/);
});
