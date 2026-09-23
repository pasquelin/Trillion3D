import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLASS_DEPTH_UNITS,
  CLASS_FEATURE,
  MATERIAL_CLASS_KEYS,
  MATERIAL_CLASS_WGSL,
  materialClassKey,
} from './visibilityMaterialClass.ts';
import {
  FLAG_HAS_MAP,
  FLAG_HAS_NORMAL,
  FLAG_HAS_UV,
  FLAG_MASK,
  SHADE_SHADER,
} from './visibilityBuffer.ts';
import { installGpuGlobals } from '../../tests/kit/gpu/globals.ts';
import { DIAGNOSTICS } from '../sdk-core/src/index.ts';
import { createExplorerDiagnosticApi } from './explorerDiagnosticApi.ts';
import { createWebgpuShadePipelines } from './webgpuVisibilityPipelines.ts';

const noMaps = { rough: 0, metal: 0, ao: 0, emissive: 0, normal: 0 };
const { HAS_UV, HAS_MAP, HAS_MASK, HAS_ROUGH, HAS_NORMAL_MAP, HAS_VERTEX_NORMAL } = CLASS_FEATURE;

test('a class key carries the resolve features of a row, and nothing a class does not branch on', () => {
  assert.equal(materialClassKey(0, noMaps), 0);
  assert.equal(
    materialClassKey(FLAG_HAS_UV | FLAG_HAS_MAP | FLAG_MASK, noMaps),
    HAS_UV | HAS_MAP | HAS_MASK,
  );
  assert.equal(
    materialClassKey(FLAG_HAS_NORMAL, { ...noMaps, rough: 3, normal: 2 }),
    HAS_VERTEX_NORMAL | HAS_ROUGH | HAS_NORMAL_MAP,
  );
  // Lit, back-side and the row's other bits select a value in the shader; they do not branch.
  assert.equal(materialClassKey(1 | 256 | 512 | 4096, noMaps), 0);
});

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

test('the resolve shader tests class overrides, never the page flags, for what a class fixes', () => {
  const fragment = SHADE_SHADER.slice(SHADE_SHADER.indexOf('fn shade_fs'));
  for (const name of ['HAS_UV', 'HAS_MAP', 'HAS_MASK', 'HAS_NORMAL_MAP', 'HAS_TANGENT'])
    assert.ok(fragment.includes(name), `${name} is read`);
  assert.doesNotMatch(fragment, /page\.flags&(?:2|4|8|16|128|2048)u/);
  assert.doesNotMatch(fragment, /page\.[a-zA-Z]+Index!=0u/);
  // One override per feature, each derived from the key the pipeline is created with.
  assert.equal(
    MATERIAL_CLASS_WGSL.match(/override [A-Z_]+:bool=\(CLASS_KEY&\d+u\)!=0u;/g)?.length,
    Object.keys(CLASS_FEATURE).length,
  );
});

test('the resolve compiles one pipeline per class under equal depth, after the depth export', async () => {
  installGpuGlobals();
  const pipelines: Array<{
    vertex: { constants?: Record<string, number> };
    fragment: { entryPoint: string; constants?: Record<string, number>; targets: unknown[] };
    depthStencil: { depthCompare: string; depthWriteEnabled: boolean; format: string };
  }> = [];
  const device = {
    createBindGroupLayout: (desc: unknown) => desc,
    createPipelineLayout: () => ({}),
    createRenderPipeline: (desc: (typeof pipelines)[number]) => (pipelines.push(desc), desc),
    pushErrorScope() {},
    popErrorScope: async () => null,
  } as unknown as GPUDevice;
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
    assert.equal(made.shadePipelines.get(key), pipeline);
  }
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
