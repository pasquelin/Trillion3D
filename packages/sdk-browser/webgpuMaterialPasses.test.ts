import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_INFO_STRIDE } from './visibilityBuffer.ts';
import { ROW_MATERIAL_CLASS_WORD } from './webgpuPageRow.ts';
import {
  MATERIAL_DEPTH_PASS,
  MATERIAL_SURFACES_PASS,
  createPresentClasses,
  encodeMaterialPasses,
} from './webgpuMaterialPasses.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { camera, quadScene } from './webgpuPagesTestScenes.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** A runtime reduced to what the resolve reads, and an encoder that records its passes. */
function resolveFixture(classes: number[], compiled: number[]) {
  const stride = PAGE_INFO_STRIDE / 4,
    ints = new Uint32Array(stride * classes.length);
  classes.forEach((key, row) => (ints[row * stride + ROW_MATERIAL_CLASS_WORD] = key));
  const made: number[] = [],
    passes: Array<{ label: string; pipelines: unknown[]; draws: number; depth: unknown }> = [];
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
      presentClasses: createPresentClasses(),
    },
  } as unknown as WebgpuPagesRuntime;
  const encoder = {
    beginRenderPass: (desc: { label: string; depthStencilAttachment: unknown }) => {
      const pass = {
        label: desc.label,
        pipelines: [] as unknown[],
        draws: 0,
        depth: desc.depthStencilAttachment,
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
