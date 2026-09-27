import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts';
import { ROW_MATERIAL_CLASS_WORD } from '../row/pageRow.ts';
import {
  MATERIAL_DEPTH_PASS,
  MATERIAL_SURFACES_PASS,
  createPresentClasses,
  encodeMaterialPasses,
} from './materialPasses.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { webgpuPagesBackend } from '../pages/pages.ts';
import { camera, quadScene } from '../pages/testScenes.fixture.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** A runtime reduced to what the resolve reads, and an encoder that records its passes. */
function resolveFixture(classes: number[], compiled: number[], single: number[] = []) {
  const stride = PAGE_INFO_STRIDE / 4,
    ints = new Uint32Array(stride * classes.length);
  classes.forEach((key, row) => (ints[row * stride + ROW_MATERIAL_CLASS_WORD] = key));
  const made: number[] = [],
    passes: Array<{
      label: string;
      pipelines: unknown[];
      draws: number;
      depth: unknown;
      colors: unknown[];
    }> = [];
  const pipeline = (key: number) => ({ key });
  const rt = {
    gpu: {
      surfaces: { views: () => ['a', 'b', 'c', 'd'] },
      targetSize: [8, 4],
      feedbackView: 'feedback',
    },
    run: { feedbackWritten: false, gpuDrawCalls: 0 },
    layout: { rows: { pageTableInts: ints, packedCount: classes.length } },
    vis: {
      materialDepthView: 'material depth',
      materialDepthPipeline: 'depth pipeline',
      shadeBindGroup: 'bind group',
      shadePipelines: new Map(compiled.map((key) => [key, pipeline(key)])),
      shadePipelineFor: (key: number) => (made.push(key), pipeline(key)),
      singleShadePipelines: new Map(single.map((key) => [key, pipeline(key)])),
      presentClasses: createPresentClasses(),
    },
  } as unknown as WebgpuPagesRuntime;
  const encoder = {
    beginRenderPass: (desc: {
      label: string;
      depthStencilAttachment?: unknown;
      colorAttachments?: unknown[];
    }) => {
      const pass = {
        label: desc.label,
        pipelines: [] as unknown[],
        draws: 0,
        depth: desc.depthStencilAttachment,
        colors: desc.colorAttachments ?? [],
      };
      passes.push(pass);
      return {
        setViewport() {},
        setBindGroup() {},
        setPipeline: (p: unknown) => pass.pipelines.push(p),
        draw: () => pass.draws++,
        end() {},
      };
    },
  } as unknown as GPUCommandEncoder;
  return { rt, encoder, passes, made };
}

test('one present class shades directly into the cleared surfaces', () => {
  const { rt, encoder, passes } = resolveFixture([5], [5], [5]);
  encodeMaterialPasses(rt, encoder);
  assert.deepEqual(
    passes.map((pass) => [pass.label, pass.draws]),
    [[MATERIAL_SURFACES_PASS, 1]],
  );
  assert.equal(passes[0].depth, undefined);
  const colors = passes[0].colors as Array<{
    view: unknown;
    loadOp: string;
    storeOp: string;
    clearValue?: unknown;
  }>;
  assert.deepEqual(
    colors.map(({ view, loadOp, storeOp }) => [view, loadOp, storeOp]),
    [
      ['a', 'clear', 'store'],
      ['b', 'clear', 'store'],
      ['c', 'clear', 'store'],
      ['d', 'clear', 'store'],
      ['feedback', 'clear', 'store'],
    ],
  );
  assert.deepEqual(
    colors.slice(0, 4).map(({ clearValue }) => clearValue),
    [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  );
  assert.equal(rt.run.feedbackWritten, true);
  assert.equal(rt.run.gpuDrawCalls, 1);
});

test('one class keeps material depth when direct shading is unavailable', () => {
  const { rt, encoder, passes } = resolveFixture([5], [5]);
  encodeMaterialPasses(rt, encoder);
  assert.deepEqual(
    passes.map((pass) => [pass.label, pass.draws]),
    [
      [MATERIAL_DEPTH_PASS, 1],
      [MATERIAL_SURFACES_PASS, 1],
    ],
  );
  assert.deepEqual(passes[1].depth, { view: 'material depth', depthReadOnly: true });
  assert.equal(rt.run.gpuDrawCalls, 2);
});

test('an empty class census retains the clearing depth and surfaces passes', () => {
  const { rt, encoder, passes } = resolveFixture([], []);
  encodeMaterialPasses(rt, encoder);
  assert.deepEqual(
    passes.map((pass) => [pass.label, pass.draws]),
    [
      [MATERIAL_DEPTH_PASS, 1],
      [MATERIAL_SURFACES_PASS, 0],
    ],
  );
  assert.equal(rt.run.gpuDrawCalls, 1);
});

test('an image draws each class of its rows once, compiling on the spot one the census missed', () => {
  const { rt, encoder, passes, made } = resolveFixture([5, 9, 5, 2], [5, 9]);
  encodeMaterialPasses(rt, encoder);
  assert.deepEqual(
    passes.map((pass) => [pass.label, pass.draws]),
    [
      [MATERIAL_DEPTH_PASS, 1],
      [MATERIAL_SURFACES_PASS, 3],
    ],
  );
  const [depth, surfaces] = passes;
  assert.deepEqual(depth.pipelines, ['depth pipeline']);
  assert.deepEqual(depth.depth, {
    view: 'material depth',
    depthClearValue: 0,
    depthLoadOp: 'clear',
    depthStoreOp: 'store',
  });
  // Rows of class 5 twice: one draw; class 2 had no pipeline: made once, then drawn.
  assert.deepEqual(surfaces.pipelines, [{ key: 5 }, { key: 9 }, { key: 2 }]);
  assert.deepEqual(surfaces.depth, { view: 'material depth', depthReadOnly: true });
  assert.deepEqual(made, [2]);
  assert.equal(rt.vis.shadePipelines.get(2)?.constructor, Object);
  assert.equal(rt.run.gpuDrawCalls, 4, 'the depth export, then one draw per class present');
});

test('a resolve without its target or bind group fails by name instead of drawing nothing', () => {
  const { rt, encoder } = resolveFixture([5], [5]);
  rt.vis.shadeBindGroup = undefined;
  assert.throws(() => encodeMaterialPasses(rt, encoder), /MATERIAL_DEPTH_UNAVAILABLE/);
});

test('disposing the backend destroys the material depth with the visibility target', async () => {
  installGpuGlobals();
  const { device, textures } = mockGpu();
  const { source, metadata, indices, associations } = quadScene();
  const backend = webgpuPagesBackend({
    source,
    metadata,
    indices,
    associations,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  await backend.prepare();
  backend.render(camera());
  const depth = textures.filter((texture) => texture.label === MATERIAL_DEPTH_PASS);
  assert.equal(depth.length, 1);
  assert.equal(depth[0].format, 'depth32float');
  assert.equal(depth[0].destroyed, false);
  backend.dispose();
  assert.equal(depth[0].destroyed, true);
});
