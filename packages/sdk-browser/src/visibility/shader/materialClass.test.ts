import test from 'node:test';
import assert from 'node:assert/strict';
import { MATERIAL_CLASS_KEYS, MATERIAL_CLASS_WGSL } from './materialClass.ts';
import { SHADE_SHADER } from '../buffer.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { DIAGNOSTICS } from '../../../../sdk-core/src/index.ts';
import { createExplorerDiagnosticApi } from '../../world/api/diagnosticApi.ts';
import { createWebgpuShadePipelines } from '../../webgpu/visibility/pipelines.ts';

const CLASS_DEPTH_UNITS = 16384;

test('every class depth is exact in f32, distinct, above the background and below one', () => {
  // The depth both shader stages compute: `(key + 1) / CLASS_DEPTH_UNITS`, in f32.
  const seen = new Set<number>();
  for (let key = 0; key < MATERIAL_CLASS_KEYS; key++) {
    const depth = (key + 1) / CLASS_DEPTH_UNITS;
    assert.equal(Math.fround(depth), depth, `key ${key} rounds`);
    assert.ok(depth > 0 && depth < 1);
    seen.add(depth);
  }
  assert.equal(seen.size, MATERIAL_CLASS_KEYS);
  assert.match(MATERIAL_CLASS_WGSL, new RegExp(`f32\\(CLASS_KEY\\+1u\\)/${CLASS_DEPTH_UNITS}\\.0`));
});

// #347: the resolve multiplied nothing by the vertex colour, and WebGPU drew white where the
// forward path drew the gradient. A class with vertex colours multiplies the base colour by the
// perspective-correct interpolation of the three corners, read on the page where it is quantized.

test('the resolve trusts the raster that kept the pixel: no second cutout', () => {
  const fragment = SHADE_SHADER.slice(SHADE_SHADER.indexOf('fn shade_fs'));
  // The raster's test (`maskKeep`) is the only cutout; the resolve reads the colour, anisotropic.
  assert.doesNotMatch(SHADE_SHADER, /fn maskAlpha\(/);
  assert.ok(fragment.includes('rgb=rgb*colorSample(page.mapIndex,uv,ddx,ddy,HAS_SAMPLING).xyz;'));
  assert.doesNotMatch(fragment, /baseColor\.w/);
  assert.match(
    fragment,
    /if\(id==0u\)\{discard;\}\s*let pageIndex=\(id>>8u\)-1u;\s*if\(pageIndex>=uni\.pageCount\)\{discard;\}/,
  );
  assert.equal(
    fragment.match(/discard;/g)?.length,
    3,
    'visibility bounds and class ownership guard storage writes',
  );
});

test('the resolve compiles one pipeline per class under equal depth, after the depth export', async () => {
  const { device, renderPipelines } = fakeDevice();
  const pipelines = renderPipelines as unknown as Array<{
    vertex: { constants?: Record<string, number> };
    fragment: { entryPoint: string; constants?: Record<string, number>; targets: unknown[] };
    depthStencil: { depthCompare: string; depthWriteEnabled: boolean; format: string };
  }>;
  const made = await createWebgpuShadePipelines(device, {} as GPUShaderModule, [0, 5]);
  assert.equal(pipelines.length, 3);
  const [depth, first, second] = pipelines;
  assert.equal(depth.fragment.entryPoint, 'material_depth_fs');
  assert.deepEqual(depth.fragment.targets, []);
  assert.equal(depth.depthStencil.depthCompare, 'always');
  assert.equal(depth.depthStencil.depthWriteEnabled, true);
  for (const [key, pipeline] of [
    [0, first],
    [5, second],
  ] as const) {
    assert.equal(pipeline.fragment.entryPoint, 'shade_fs');
    assert.deepEqual(pipeline.vertex.constants, { CLASS_KEY: key });
    assert.deepEqual(pipeline.fragment.constants, { CLASS_KEY: key });
    assert.equal(pipeline.depthStencil.depthCompare, 'equal');
    assert.equal(pipeline.depthStencil.depthWriteEnabled, false);
    assert.equal(pipeline.depthStencil.format, depth.depthStencil.format);
    assert.equal(made.shadePipelines.get(key), pipeline as unknown as GPURenderPipeline);
  }
});

test('one production class also compiles a direct surface pipeline without material depth', async () => {
  const { device, renderPipelines } = fakeDevice();
  const made = await createWebgpuShadePipelines(device, {} as GPUShaderModule, [5]);
  const direct = made.singleShadePipelines.get(5) as unknown as {
    vertex: { constants?: Record<string, number> };
    fragment: { entryPoint: string; constants?: Record<string, number>; targets: unknown[] };
    depthStencil?: unknown;
  };
  assert.ok(renderPipelines.includes(direct as unknown as GPURenderPipelineDescriptor));
  assert.equal(direct.fragment.entryPoint, 'shade_fs');
  assert.deepEqual(direct.vertex.constants, { CLASS_KEY: 5, SINGLE_CLASS: 1 });
  assert.deepEqual(direct.fragment.constants, { CLASS_KEY: 5, SINGLE_CLASS: 1 });
  assert.equal(direct.fragment.targets.length, 5);
  assert.equal(direct.depthStencil, undefined);

  const diagnostic = await createWebgpuShadePipelines(
    fakeDevice().device,
    {} as GPUShaderModule,
    [5],
    'resolve-flat',
  );
  assert.equal(diagnostic.singleShadePipelines.size, 0);
});

test('the materials view colours a pixel by the class that resolved it, on the WebGPU path only', () => {
  assert.equal(DIAGNOSTICS.materials.available, true);
  assert.match(
    SHADE_SHADER,
    /if\(uni\.mode==7u\)\{return diagnosticSurface\(hashColor\(CLASS_KEY\),request\);\}/,
  );
  const modes: string[] = [];
  const backend = (id: string) =>
    ({ id, setDiagnostic: (mode: string) => modes.push(`${id}:${mode}`) }) as never;
  const forward = backend('exact-cluster-pages'),
    visibility = backend('webgpu-page-raster');
  const api = (active: never) =>
    createExplorerDiagnosticApi({
      check() {},
      active: () => active,
      backends: [forward, visibility],
      beautyMaterials: new Map(),
      overlays: [],
      setMode: (mode) => modes.push(`mode:${mode}`),
    });
  assert.throws(() => api(forward).setDiagnostic('materials'), /WebGPU visibility path/);
  assert.deepEqual(modes, []);
  api(visibility).setDiagnostic('materials');
  assert.deepEqual(modes, [
    'exact-cluster-pages:materials',
    'webgpu-page-raster:materials',
    'mode:materials',
  ]);
});
