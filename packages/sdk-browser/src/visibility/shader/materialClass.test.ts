import test from 'node:test'
import assert from 'node:assert/strict'
import { MATERIAL_CLASS_WGSL, materialClassKey } from './materialClass.ts'
import {
  FLAG_HAS_COLOR,
  FLAG_HAS_MAP,
  FLAG_HAS_NORMAL,
  FLAG_HAS_UV,
  FLAG_MASK,
  FLAG_VOXEL,
} from '../types.ts'
import { SHADE_SHADER } from './shadeWgsl.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { DIAGNOSTICS } from '../../../../sdk-core/src/runtime/diagnostics.ts'
import { createExplorerDiagnosticApi } from '../../api/diagnosticApi.ts'
import { createWebgpuShadePipelines } from '../passes/shadePipelines.ts'
import { CLASS_FEATURE } from './classWords.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'

const noMaps = { rough: 0, metal: 0, ao: 0, emissive: 0, normal: 0 }
const { HAS_UV, HAS_MAP, HAS_MASK, HAS_ROUGH, HAS_NORMAL_MAP, HAS_VERTEX_NORMAL } = CLASS_FEATURE

test('a class key carries the resolve features of a row, and nothing a class does not branch on', () => {
  assert.equal(materialClassKey(0, noMaps), 0)
  assert.equal(
    materialClassKey(FLAG_HAS_UV | FLAG_HAS_MAP | FLAG_MASK, noMaps),
    HAS_UV | HAS_MAP | HAS_MASK,
  )
  assert.equal(
    materialClassKey(FLAG_HAS_NORMAL, { ...noMaps, rough: 3, normal: 2 }),
    HAS_VERTEX_NORMAL | HAS_ROUGH | HAS_NORMAL_MAP,
  )
  // Lit, back-side and the row's other bits select a value in the shader; they do not branch.
  assert.equal(materialClassKey(1 | 256 | 512 | 8192, noMaps), 0)
  // A voxel row resolves its voxels' own surface: a class of its own.
  assert.equal(materialClassKey(FLAG_VOXEL, noMaps), CLASS_FEATURE.VOXEL)
})

test('the resolve shader tests class overrides, never the page flags, for what a class fixes', () => {
  const fragment = SHADE_SHADER.slice(SHADE_SHADER.indexOf('fn shadeSurface'))
  // `HAS_MASK` steers the tile request only (`shadeRequest`): the cutout is the raster's.
  for (const name of ['HAS_UV', 'HAS_MAP', 'HAS_NORMAL_MAP', 'HAS_TANGENT'])
    assert.ok(fragment.includes(name), `${name} is read`)
  assert.ok(SHADE_SHADER.includes('HAS_MASK'), 'HAS_MASK is read by the request')
  assert.doesNotMatch(fragment, /page\.flags&(?:2|4|8|16|128|2048)u/)
  assert.doesNotMatch(fragment, /page\.[a-zA-Z]+Index!=0u/)
  // One override per feature, each derived from the key the pipeline is created with.
  assert.equal(
    wgslSource(MATERIAL_CLASS_WGSL).match(/override [A-Z_]+:bool=\(CLASS_KEY&\d+u\)!=0u;/g)?.length,
    Object.keys(CLASS_FEATURE).length,
  )
})

// The resolve multiplied nothing by the vertex colour, and WebGPU drew white where the
// forward path drew the gradient. A class with vertex colours multiplies the base colour by the
// perspective-correct interpolation of the three corners, read on the page where it is quantized.
test('a class with vertex colours multiplies its base colour by them, and no other class does', () => {
  assert.equal(materialClassKey(FLAG_HAS_COLOR, noMaps), CLASS_FEATURE.HAS_VERTEX_COLOR)
  const fragment = SHADE_SHADER.slice(SHADE_SHADER.indexOf('fn shadeSurface'))
  const multiply =
    'if(HAS_VERTEX_COLOR){let h=pageHeader(page);let k=pageTriangle(page,h,tri);rgb*=(pageColor(page,h,k.x)*bary.x+pageColor(page,h,k.y)*bary.y+pageColor(page,h,k.z)*bary.z).xyz;}'
  assert.equal(fragment.split(multiply).length - 1, 1)
  // After the base map, before any view or light reads `rgb`.
  assert.ok(fragment.indexOf(multiply) > fragment.indexOf('rgb=rgb*colorSample(m.mapIndex'))
  // The first view to read it, the diagnostic colour (`uni.mode!=0u`).
  assert.ok(fragment.indexOf(multiply) < fragment.indexOf('if(uni.mode!=0u){'))
  assert.match(
    SHADE_SHADER,
    /fn pageColor\(page:PageInfo,h:ClusterHeader,vertex:u32\)->vec4f\{\n if\(\(page\.flags&32u\)!=0u\)\{return clusterColor\(h,page\.pageOffset,vertex\);\}\n return vertColor\(page\.vertexBase\+vertex\);/,
  )
})

test('the resolve trusts the raster that kept the pixel: no second cutout', () => {
  const fragment = SHADE_SHADER.slice(SHADE_SHADER.indexOf('fn shadeSurface'))
  // The raster's test (`maskKeep`) is the only cutout; the resolve reads the colour, anisotropic.
  assert.doesNotMatch(SHADE_SHADER, /fn maskAlpha\(/)
  // Each map at the UV set its record names (`mapCoord`, glTF's `texCoord`).
  const base = 'mapCoord(m,0u)'
  assert.ok(
    fragment.includes(
      `rgb=rgb*colorSample(m.mapIndex,${base}.uv,${base}.ddx,${base}.ddy,HAS_SAMPLING).xyz;`,
    ),
  )
  assert.doesNotMatch(fragment, /baseColor\.w/)
  // A compute stage rejects nothing: its lanes past their bin leave before any write.
  assert.doesNotMatch(SHADE_SHADER, /discard;/)
})

test('the resolve compiles one compute pipeline per class, none a depth export', async () => {
  const { device, computePipelines } = fakeDevice()
  const made = await createWebgpuShadePipelines(device, {} as GPUShaderModule, [0, 5])
  assert.equal(computePipelines.length, 2, 'no depth export')
  const [first, second] = computePipelines
  for (const [key, pipeline] of [
    [0, first],
    [5, second],
  ] as const) {
    assert.equal(pipeline.compute.entryPoint, 'shade_cs')
    // The tile request folded in by its feedback target (`feedbackConstants`).
    assert.deepEqual(pipeline.compute.constants, { CLASS_KEY: key, FEEDBACK: 1 })
    const compiled = made.shadeClasses.of(key)
    assert.equal(compiled.ready, true, 'compiled at preparation, off the thread')
    assert.equal((compiled.get() as unknown as { entryPoint: string }).entryPoint, 'shade_cs')
  }
})

test('the materials view colours a pixel by the class that resolved it', () => {
  assert.equal(DIAGNOSTICS.materials.available, true)
  assert.match(
    SHADE_SHADER,
    /DiagnosticPixel\(page\.clusterHash,tri,page\.diagnosticWord,CLASS_KEY,/,
  )
  assert.match(
    SHADE_SHADER,
    /case 7u:\{return diagnosticShade\(hashColor\(p\.material\),p\.normal\);\}/,
  )
  const modes: string[] = []
  const engine = {
    id: 'webgpu-page-raster',
    setDiagnostic: (mode: string) => modes.push(`engine:${mode}`),
  } as never
  createExplorerDiagnosticApi({
    check() {},
    engine,
    setMode: (mode) => modes.push(`mode:${mode}`),
  }).setDiagnostic('materials')
  assert.deepEqual(modes, ['engine:materials', 'mode:materials'])
})
