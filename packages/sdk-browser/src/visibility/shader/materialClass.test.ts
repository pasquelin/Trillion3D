import test from 'node:test';
import assert from 'node:assert/strict';
import { MATERIAL_CLASS_WGSL, materialClassKey } from './materialClass.ts';
import {
  FLAG_HAS_COLOR,
  FLAG_HAS_MAP,
  FLAG_HAS_NORMAL,
  FLAG_HAS_UV,
  FLAG_MASK,
  SHADE_SHADER,
} from '../buffer.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { DIAGNOSTICS } from '../../../../sdk-core/src/index.ts';
import { createExplorerDiagnosticApi } from '../../world/api/diagnosticApi.ts';
import { createWebgpuShadePipelines } from '../../webgpu/visibility/shadePipelines.ts';
import { CLASS_FEATURE } from './classWords.ts';

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

test('the resolve shader tests class overrides, never the page flags, for what a class fixes', () => {
  const fragment = SHADE_SHADER.slice(SHADE_SHADER.indexOf('fn shadeSurface'));
  // `HAS_MASK` steers the tile request only (`shadeRequest`): the cutout is the raster's.
  for (const name of ['HAS_UV', 'HAS_MAP', 'HAS_NORMAL_MAP', 'HAS_TANGENT'])
    assert.ok(fragment.includes(name), `${name} is read`);
  assert.ok(SHADE_SHADER.includes('HAS_MASK'), 'HAS_MASK is read by the request');
  assert.doesNotMatch(fragment, /page\.flags&(?:2|4|8|16|128|2048)u/);
  assert.doesNotMatch(fragment, /page\.[a-zA-Z]+Index!=0u/);
  // One override per feature, each derived from the key the pipeline is created with.
  assert.equal(
    MATERIAL_CLASS_WGSL.match(/override [A-Z_]+:bool=\(CLASS_KEY&\d+u\)!=0u;/g)?.length,
    Object.keys(CLASS_FEATURE).length,
  );
});

// #347: the resolve multiplied nothing by the vertex colour, and WebGPU drew white where the
// forward path drew the gradient. A class with vertex colours multiplies the base colour by the
// perspective-correct interpolation of the three corners, read on the page where it is quantized.
test('a class with vertex colours multiplies its base colour by them, and no other class does', () => {
  assert.equal(materialClassKey(FLAG_HAS_COLOR, noMaps), CLASS_FEATURE.HAS_VERTEX_COLOR);
  const fragment = SHADE_SHADER.slice(SHADE_SHADER.indexOf('fn shadeSurface'));
  const multiply =
    'if(HAS_VERTEX_COLOR){let h=pageHeader(page);let k=pageTriangle(page,h,tri);rgb*=(pageColor(page,h,k.x)*bary.x+pageColor(page,h,k.y)*bary.y+pageColor(page,h,k.z)*bary.z).xyz;}';
  assert.equal(fragment.split(multiply).length - 1, 1);
  // After the base map, before any view or light reads `rgb`.
  assert.ok(fragment.indexOf(multiply) > fragment.indexOf('rgb=rgb*colorSample(page.mapIndex'));
  assert.ok(fragment.indexOf(multiply) < fragment.indexOf('if(uni.mode==1u)'));
  assert.match(
    SHADE_SHADER,
    /fn pageColor\(page:PageInfo,h:ClusterHeader,vertex:u32\)->vec4f\{\n if\(\(page\.flags&32u\)!=0u\)\{return clusterColor\(h,page\.pageOffset,vertex\);\}\n return vertColor\(page\.vertexBase\+vertex\);/,
  );
});

test('the resolve trusts the raster that kept the pixel: no second cutout', () => {
  const fragment = SHADE_SHADER.slice(SHADE_SHADER.indexOf('fn shadeSurface'));
  // The raster's test (`maskKeep`) is the only cutout; the resolve reads the colour, anisotropic.
  assert.doesNotMatch(SHADE_SHADER, /fn maskAlpha\(/);
  assert.ok(fragment.includes('rgb=rgb*colorSample(page.mapIndex,uv,ddx,ddy,HAS_SAMPLING).xyz;'));
  assert.doesNotMatch(fragment, /baseColor\.w/);
  assert.ok(fragment.includes('if(!classAdmits(id)){discard;}'));
  assert.equal(
    fragment.match(/discard;/g)?.length,
    1,
    'visibility bounds and class ownership, one reject, guard storage writes',
  );
});

test('the resolve compiles one pipeline per class, none with a depth test', async () => {
  const { device, renderPipelines } = fakeDevice();
  const pipelines = renderPipelines as unknown as Array<{
    vertex: { constants?: Record<string, number> };
    fragment: { entryPoint: string; constants?: Record<string, number>; targets: unknown[] };
    depthStencil?: unknown;
  }>;
  const made = await createWebgpuShadePipelines(device, {} as GPUShaderModule, [0, 5]);
  assert.equal(pipelines.length, 2, 'no depth export');
  const [first, second] = pipelines;
  for (const [key, pipeline] of [
    [0, first],
    [5, second],
  ] as const) {
    assert.equal(pipeline.fragment.entryPoint, 'shade_fs');
    assert.deepEqual(pipeline.vertex.constants, { CLASS_KEY: key });
    assert.deepEqual(pipeline.fragment.constants, { CLASS_KEY: key });
    assert.equal(pipeline.depthStencil, undefined);
    const compiled = made.shadeClasses.of(key);
    assert.equal(compiled.ready, true, 'compiled at preparation, off the thread');
    assert.equal(compiled.get(), pipeline as unknown as GPURenderPipeline);
  }
});

test('one production class also compiles a direct surface pipeline', async () => {
  const { device, renderPipelines } = fakeDevice();
  const made = await createWebgpuShadePipelines(device, {} as GPUShaderModule, [5]);
  const direct = made.shadeClasses.single(5)!.get() as unknown as {
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
  assert.equal(diagnostic.shadeClasses.single(5), undefined);
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
