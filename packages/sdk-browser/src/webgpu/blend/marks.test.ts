// #1411: the blend runs mark the shadow pages they read in a pass of their own, after the opaque
// demand and before the allocation maps the pages: the runs are expanded first, the pass draws
// them through the demand's `demandLight`, and writes neither colour nor depth.
import test from 'node:test';
import assert from 'node:assert/strict';
import { functionsOf } from '../../texture/shaderRule.fixture.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { prepared, replay, targets } from '../water/pass.fixture.ts';
import { createWebgpuLightState } from '../pages/state/lights.ts';
import { encodeShadowAsks } from '../shadow/allocPass.ts';
import { SHADOW_DEMAND_LIGHT_WGSL } from '../shadow/demandWgsl.ts';
import { encodeBlendShadowMarks, prepareBlendShadowMarks } from './marks.ts';
import { prepareBlend } from '../pages/render/encodeBlend.ts';
import { blendShadowMarksWgsl } from './marksWgsl.ts';
import type { BlendExpand } from './expand.ts';
import type { WaterPass } from '../water/waterPass.ts';
import { BLEND_SHADOW_MARKS_PASS } from '../../stage/passLabels.ts';

const EXPANSION = 'Trillion3D blend expansion';

/** A lit image of the water fixture's three transparents, with its shadow page passes recorded in
 *  `log` as they are encoded, and the marks pass's descriptor and draws; `water`, with the water
 *  pass that composes its transmissive copy. */
async function litImage(water = false) {
  const { device, renderPipelines } = fakeDevice();
  const { blendState, gpu } = prepared();
  targets(gpu);
  const { rt } = replay(blendState, gpu);
  const log: string[] = [],
    marks: { pass?: GPURenderPassDescriptor; pipelines: unknown[]; draws: number } = {
      pipelines: [],
      draws: 0,
    };
  // The GPU expansion, recorded by the compute pass it opens.
  blendState.expand = { uploadPlan() {}, uploadKeep() {}, encode() {} } as unknown as BlendExpand;
  const lights = createWebgpuLightState(32),
    note = (name: string) => () => log.push(name);
  Object.assign(lights, {
    buffer: {},
    tiles: { buffer: {} },
    shadows: { texture: {}, dataBuffer: {}, flushRecords() {} },
    pageRequests: {
      buffer: {},
      allocation: { seeded: true, writeParams() {}, state: {}, keys: {}, params: {}, drawList: {} },
    },
    allocation: { floors: note('floors'), allocate: note('allocate') },
    demand: note('demand'),
  });
  // What the blend runs draw with (`prepareBlend`): the textured pass's resources.
  const visibility = {
    ...{ visView: {}, shadeUniform: {}, pageTable: {}, concatPos: {}, concatNrm: {} },
    ...{ concatUv: {}, blendBindGroupLayout: {}, textures: {}, mapsSampler: {} },
  };
  Object.assign(rt, {
    lights,
    vis: { ...rt.vis, ...visibility },
    timing: { transparentPrepareMs: 0, transparentEncodeMs: 0 },
  });
  // The fixture's eye, where its sort placed the copies (`prepared`).
  Object.assign(rt.run, { frame: 1, lastCamera: {}, gate: { cam: { eye: [0, 0, 0] } } });
  Object.assign(gpu, { cache: { buffer: {} }, pipelineBlend: {}, uniformBuffer: {}, zeroUv: {} });
  if (water) blendState.water = {} as WaterPass;
  await prepareBlendShadowMarks(rt, device);
  Object.assign(blendState, { itemBuffer: {}, expandedBuffer: {} });
  const encoder = {
    beginComputePass: ({ label }: GPUComputePassDescriptor) => {
      log.push(label!);
      return { end() {} };
    },
    beginRenderPass: (pass: GPURenderPassDescriptor) => {
      log.push(pass.label!);
      if (pass.label === BLEND_SHADOW_MARKS_PASS) marks.pass = pass;
      return {
        setViewport() {},
        setBindGroup() {},
        setPipeline: (pipeline: unknown) => marks.pipelines.push(pipeline),
        drawIndirect: () => marks.draws++,
        end() {},
      };
    },
  } as unknown as GPUCommandEncoder;
  return { rt, device, encoder, log, marks, renderPipelines };
}

/** The image's order (`encodeSurfaceLighting`, `encodeDirectLights`): the blend runs prepared and
 *  expanded, then the floors, the pixels' demand, the runs' marks and the allocation. */
function encodeImageAsks({ rt, device, encoder }: Awaited<ReturnType<typeof litImage>>) {
  const blendRuns = prepareBlend(rt, device, encoder, true);
  assert.equal(blendRuns, true, 'the blend runs draw the transparents');
  encodeShadowAsks(rt, encoder, true, () => encodeBlendShadowMarks(rt, device, encoder));
}

test('the blend runs are expanded and mark their pages after the demand, before the allocation', async () => {
  const image = await litImage();
  encodeImageAsks(image);
  assert.deepEqual(image.log, [EXPANSION, 'floors', 'demand', BLEND_SHADOW_MARKS_PASS, 'allocate']);
  assert.ok(image.marks.draws > 0, 'the marks draw the blend runs');
});

test('the blend marks call demandLight and write no colour or depth', async () => {
  const image = await litImage();
  const { marks, renderPipelines } = image;
  encodeImageAsks(image);
  assert.deepEqual(marks.pass!.colorAttachments, [], 'no colour attachment');
  assert.equal(marks.pass!.depthStencilAttachment!.depthReadOnly, true, 'the depth is read only');
  // One pipeline per cull mode, each of the marks' fragment stage, with no target and no write.
  assert.equal(renderPipelines.length, 3);
  for (const pipeline of renderPipelines) {
    assert.equal(pipeline.fragment!.entryPoint, 'markShadows');
    assert.deepEqual([...pipeline.fragment!.targets], []);
    assert.equal(pipeline.depthStencil!.depthWriteEnabled, false);
  }
  assert.ok(marks.pipelines.every((pipeline) => renderPipelines.includes(pipeline as never)));
  // The stage marks through the demand's own `demandLight`: one demand path, not a second.
  const wgsl = blendShadowMarksWgsl();
  assert.match(functionsOf(wgsl, ['markShadows']), /markBlendShadows\(/);
  assert.match(functionsOf(wgsl, ['markBlendShadows']), /demandSlice\(/);
  assert.match(functionsOf(wgsl, ['demandSlice']), /demandLight\(directLights/);
  assert.ok(wgsl.includes(SHADOW_DEMAND_LIGHT_WGSL), 'the demand functions, verbatim');
  assert.equal(wgsl.split('fn demandLight(').length, 2, 'declared once');
  // No two resources of the module share a binding: its other stages declare group 2 too.
  const bindings = [...wgsl.matchAll(/@group\((\d+)\) @binding\((\d+)\)/g)].map(([at]) => at);
  assert.equal(new Set(bindings).size, bindings.length);
});

test('the water marks call demandLight and run after the demand, before the allocation', async () => {
  const image = await litImage(true);
  const { marks, renderPipelines } = image;
  encodeImageAsks(image);
  assert.deepEqual(image.log, [EXPANSION, 'floors', 'demand', BLEND_SHADOW_MARKS_PASS, 'allocate']);
  assert.ok(image.rt.blendState.transmissiveInView > 0, 'witness: the water is in view');
  // The transmission slice draws with the water stage, which writes no colour and no depth.
  const water = renderPipelines.filter((p) => p.fragment!.entryPoint === 'markWaterShadows');
  assert.equal(water.length, 3);
  for (const pipeline of water) {
    assert.deepEqual([...pipeline.fragment!.targets], []);
    assert.equal(pipeline.depthStencil!.depthWriteEnabled, false);
  }
  assert.ok(marks.pipelines.some((pipeline) => water.includes(pipeline as never)));
  // Through the demand's own `demandLight`, as the blends' marks.
  const wgsl = blendShadowMarksWgsl();
  assert.match(functionsOf(wgsl, ['markWaterShadows']), /markWaterAt\(/);
  assert.match(functionsOf(wgsl, ['markWaterAt']), /markBlendShadows\(/);
});
