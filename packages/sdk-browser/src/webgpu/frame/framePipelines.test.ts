// What enters the scene after preparation — a resolve class a material changed into, a surface
// that came to emit, a guide shown — has its pipelines asked at the next frame entry, compiled off
// the thread while the frame is held on them, the previous image shown: no frame compiles one, and
// each is the pipeline the frame would have compiled itself, descriptor for descriptor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { holdWebgpuFrame, keepWebgpuFrame } from './hold.ts';
import { settledRt } from './hold.fixture.ts';
import { askFramePipelines } from './framePipelines.ts';
import { deviceAnswer } from './deviceAnswer.ts';
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts';
import { gatedDevice } from '../../lighting/deferred/gatedDevice.fixture.ts';
import { createWebgpuShadePipelines } from '../visibility/shadePipelines.ts';
import type { ShadeCensus } from '../visibility/shadeCensus.ts';
import { createGuideSet } from '../../guides/guideSet.ts';
import { families } from '../../host/families.ts';

await families.guides.load();

/** A settled runtime on a gated device, its hold armed by two identical frames. */
function armed() {
  const gpu = gatedDevice(),
    rt = settledRt();
  Object.assign(rt.gpu, { device: gpu.device });
  for (let i = 0; i < 2; i++) {
    rt.run.frame++;
    keepWebgpuFrame(rt);
  }
  return { ...gpu, rt };
}

/** A census whose classes and emission the test sets, taken anew once moved. */
function census(keys: number[], emits = false) {
  let stale = false;
  return {
    keys,
    emits,
    moved: () => void (stale = true),
    retake: () => (stale ? !(stale = false) : false),
  } satisfies ShadeCensus;
}

/** The scene's resolve classes, compiled as prepare leaves them. */
async function classes(gpu: ReturnType<typeof gatedDevice>, keys: number[], emissiveAo = true) {
  let done = false;
  const module = {} as GPUShaderModule;
  const made = createWebgpuShadePipelines(
    gpu.device,
    module,
    keys,
    undefined,
    true,
    undefined,
    emissiveAo,
  ).finally(() => (done = true));
  while (!done) await gpu.land();
  return (await made).shadeClasses;
}

const fragmentOf = (pipeline: unknown) => (pipeline as GPURenderPipelineDescriptor).fragment!;

test('a frame entry holds the image while a pipeline its frame binds compiles, and draws once it landed', async () => {
  const { rt, device, compiled, land } = armed();
  const pipeline = preparedPipeline(device, { layout: 'auto', vertex: {} as never }).ask();
  assert.equal(holdWebgpuFrame(rt, device), true, 'held: the previous image shown');
  assert.equal(rt.run.frameHeld, false, 'on an answer, not as a still frame');
  const answer = deviceAnswer(rt);
  assert.ok(answer, 'the loop waits for the compile');
  await land();
  await answer;
  assert.equal(pipeline.ready, true);
  assert.equal(holdWebgpuFrame(rt, device), true);
  assert.equal(rt.run.frameHeld, true, 'landed: a still frame again');
  assert.equal(compiled.sync, 0, 'no frame compiled it');
});

test('a class a material changed into compiles off the frame before the image that draws it', async () => {
  const armedRt = armed(),
    { rt, device, compiled } = armedRt;
  const scene = census([5]);
  Object.assign(rt.vis, { shadeCensus: scene, shadeClasses: await classes(armedRt, [5]) });
  askFramePipelines(rt);
  assert.equal(holdWebgpuFrame(rt, device), true);
  assert.equal(rt.run.frameHeld, true, 'nothing moved: nothing asked');
  scene.keys = [5, 9];
  scene.moved();
  askFramePipelines(rt);
  assert.equal(holdWebgpuFrame(rt, device), true, 'the image is held on class 9');
  assert.equal(rt.run.frameHeld, false);
  await armedRt.land();
  const nine = rt.vis.shadeClasses!.of(9);
  assert.equal(nine.ready, true);
  assert.deepEqual(fragmentOf(nine.get()).constants, { CLASS_KEY: 9 }, 'the class of before');
  assert.equal(compiled.sync, 0, 'no frame compiled a class');
});

test('a surface that came to emit switches the classes once those writing the layer compiled', async () => {
  const armedRt = armed(),
    { rt, device, compiled } = armedRt;
  const scene = census([5, 9]);
  const before = await classes(armedRt, [5, 9], false);
  assert.deepEqual(fragmentOf(before.of(5).get()).constants, { CLASS_KEY: 5, EMISSIVE_AO: 0 });
  Object.assign(rt.vis, { shadeCensus: scene, shadeClasses: before, writesEmissiveAo: false });
  scene.emits = true;
  scene.moved();
  askFramePipelines(rt);
  assert.equal(holdWebgpuFrame(rt, device), true, 'held on the classes writing the layer');
  assert.equal(rt.vis.shadeClasses, before, 'the set in place until they compiled');
  assert.equal(rt.vis.writesEmissiveAo, false);
  await armedRt.land();
  askFramePipelines(rt);
  const after = rt.vis.shadeClasses!;
  assert.notEqual(after, before);
  assert.equal(rt.vis.writesEmissiveAo, true);
  for (const key of [5, 9]) {
    const fragment = fragmentOf(after.of(key).get());
    assert.deepEqual(fragment.constants, { CLASS_KEY: key }, 'the layer written');
    assert.deepEqual([...fragment.targets][2], { format: 'rgba16float' });
  }
  assert.equal(compiled.sync, 0);
});

test('the guide pass is made by the frame entry that first shows a guide, its pipeline compiled off it', async () => {
  const { rt, device, compiled, land } = armed();
  const guides = createGuideSet();
  rt.context.guides = guides;
  askFramePipelines(rt);
  assert.equal(rt.gpu.guides, undefined, 'no guide shown: no pass');
  guides.lines({ positions: [0, 0, 0, 1, 0, 0] });
  askFramePipelines(rt);
  assert.equal(holdWebgpuFrame(rt, device), true, 'held on the guide pipeline');
  assert.ok(rt.gpu.guides);
  await land();
  assert.equal(holdWebgpuFrame(rt, device), false, 'then drawn, the guide with it');
  assert.equal(compiled.sync, 0);
});
