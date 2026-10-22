import test from 'node:test'
import assert from 'node:assert/strict'
import { FEATURE_CLASS_KEYS, MATERIAL_CLASS_WGSL, materialClassKey } from './materialClass.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture as WorldTexture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { isProgram, programOf } from '../../materials/graph/surfaceProgram.ts'
import { graphClassKey } from '../../materials/graph/surfaceClasses.ts'
import {
  FLAG_DISPLACED,
  FLAG_DYNAMIC,
  FLAG_HAS_COLOR,
  FLAG_HAS_MAP,
  FLAG_HAS_NORMAL,
  FLAG_HAS_UV,
  FLAG_LINE,
  FLAG_MASK,
  FLAG_SPRITE,
  FLAG_VOXEL,
} from '../types.ts'
import { SHADE_SHADER, shadeShader } from './shadeWgsl.ts'
import { DISPLACED_SHADE_BINDINGS } from '../tessellation/prismWgsl.ts'
import { displacedShadeLayout } from '../tessellation/prismFrame.ts'
import { TESSELLATED_FLAGS_WGSL } from '../tessellation/rowWgsl.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { shadeLayoutEntries } from '../passes/shadeLayout.ts'
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

/** The bindings of group 0 a resolve text declares. */
const declaredBindings = (code: string) =>
  [...code.matchAll(/@group\(0\) @binding\((\d+)\)/g)]
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b)

test('a displaced class’s resolve is a module of its own over a group of its own; the others compile what they did', async () => {
  // The plain text holds none of it; the displaced one places the pixel by the prism's weights and
  // declares the two bindings its group adds.
  const displaced = shadeShader({ displaced: true })
  assert.doesNotMatch(SHADE_SHADER, /solveDisplaced|prismDepth|prism\./)
  assert.match(SHADE_SHADER, /let bary=perspectiveBarycentric/)
  assert.match(displaced, /var bary=perspectiveBarycentric/)
  assert.match(displaced, /if\(prism\.tessellation!=0u&&tessellatedFlags\(page\)\)\{/)
  const added = Object.values(DISPLACED_SHADE_BINDINGS)
  assert.deepEqual(declaredBindings(displaced), [...declaredBindings(SHADE_SHADER), ...added])
  // Their layout: the resolve's entries and those two — the depth, and the uniform.
  const { device, computePipelines, pipelineLayouts } = fakeDevice()
  const layout = displacedShadeLayout(device) as unknown as { entries: GPUBindGroupLayoutEntry[] }
  assert.deepEqual(
    layout.entries.map((e) => e.binding).sort((a, b) => a - b),
    [...shadeLayoutEntries().map((e) => e.binding), ...added].sort((a, b) => a - b),
  )
  const [depth, uniform] = added.map((b) => layout.entries.find((e) => e.binding === b)!)
  assert.equal(depth!.texture?.sampleType, 'depth')
  assert.equal(uniform!.buffer?.type, 'uniform')
  // A scene that tessellates nothing never makes the module or the layout.
  const made = await createWebgpuShadePipelines(device, {} as GPUShaderModule, [0, 5])
  assert.equal(computePipelines.length, 2)
  assert.equal(pipelineLayouts.length, 1, 'the classes’ one layout, none of the displaced')
  // Asked, class 5 has a pipeline over the displaced text and group; the plain one is as it was.
  await made.shadeClasses.displaced(5).prepare()
  assert.equal(computePipelines.length, 3)
  assert.equal(pipelineLayouts.length, 2, 'the displaced group’s own layout, made once asked')
  const [plain, , own] = [computePipelines[1]!, computePipelines[0]!, computePipelines[2]!]
  assert.deepEqual(own.compute.constants, plain.compute.constants)
  assert.equal((own.compute.module as unknown as { code: string }).code, displaced)
  assert.equal(
    plain.compute.module,
    computePipelines[0]!.compute.module,
    'the plain classes share theirs',
  )
  assert.notEqual(own.layout, plain.layout)
})

test('a displaced row is tessellated whatever moves or cuts it, and left as it is only when it is no triangle surface', () => {
  const { tessellatedFlags } = shaderRun<{
    tessellatedFlags(page: { flags: number; deformOutput: number }): boolean
  }>(wgslBlock('rows', [TESSELLATED_FLAGS_WGSL], ''), ['tessellatedFlags'], {})
  const drawn = (flags: number, deformOutput = 0) =>
    tessellatedFlags({ flags: (flags | FLAG_DISPLACED) >>> 0, deformOutput })
  // A masked row is cut out at the vertices of its micro-triangles; a skinned or morphed one — its
  // corners deformed this frame — and one the host rewrites in place are diced as they stand.
  assert.deepEqual(
    [drawn(0), drawn(FLAG_MASK), drawn(0, 7), drawn(FLAG_MASK, 7), drawn(FLAG_DYNAMIC)],
    [true, true, true, true, true],
  )
  // A line, a sprite and a voxel brick have no surface to push along a normal; a row that is not
  // displaced is none of the tessellation's.
  assert.deepEqual(
    [FLAG_LINE, FLAG_SPRITE, FLAG_VOXEL].map((flag) => drawn(flag)),
    [false, false, false],
  )
  assert.equal(tessellatedFlags({ flags: FLAG_MASK, deformOutput: 7 }), false)
})

/** The program of a graph that reads a texture, for the surface resolve. */
function textured() {
  const graph = material.graph('surface')
  graph.output('baseColor', graph.channel(graph.textureSample(new WorldTexture()), 'rgb'))
  graph.output('normal', graph.constant(0, 0, 1))
  const program = programOf({ graph })
  if (!isProgram(program)) throw new Error('the graph of the test does not compile')
  return program
}

test('the resolve of a graph reads its values from the material table and asks the tiles of its textures', () => {
  const { compiled } = textured()
  const text = shadeShader({ graph: compiled })
  const fragment = text.slice(text.indexOf('fn shadeSurface'))
  assert.match(fragment, /mgGiven=mgLoad\(max\(m\.graph,1u\)-1u\);/, 'the values beside the record')
  assert.match(fragment, /rgb=saturate\(mgBaseColor\(mgPixel,mgGiven\)\);/)
  // The normal the graph wires bends the vertex normal as a map does, at the pixel and its neighbours.
  assert.match(fragment, /N=bendNormal\(N,mgT,mgB,mgFlip,mgMap\);/)
  assert.match(fragment, /mgMapX=mgNormal\(mgNeighbour\[0\],mgGiven\)/)
  // An output it does not wire is its default; one it wires is held as the reference holds it.
  assert.match(fragment, /metal=ormMetalness\(1\.0,0\.00000000\);/)
  // The pixel asks one of the graph's reads, never one of the maps': the tile request is its own.
  assert.match(text, /fn shadePick\(p:RequestPick,missing:bool,m:Material\)->u32\{return mgAsk\(/)
  assert.match(text, /let choices=1u;/)
  assert.doesNotMatch(text, /MAP_CHOICES\+1u\+select/)
  // The module of a surface with no graph holds none of it.
  assert.doesNotMatch(SHADE_SHADER, /mgPixel|mgLoad/)
  assert.match(SHADE_SHADER, /binOfClass\(CLASS_BIN\)/)
})

test('a class of a graph is compiled with its features, binned under its own key, over its program’s module', async () => {
  const program = textured()
  const first = graphClassKey(program, HAS_UV)!,
    second = graphClassKey(program, HAS_UV | HAS_VERTEX_NORMAL)!
  assert.ok(first >= FEATURE_CLASS_KEYS && second === first + 1)
  assert.equal(graphClassKey(program, HAS_UV), first, 'a class once made is kept')
  const { device, computePipelines } = fakeDevice()
  const plain = {} as GPUShaderModule
  const made = await createWebgpuShadePipelines(device, plain, [0, first, second])
  assert.equal(made.shadeClasses.of(first).ready, true)
  const [none, one, two] = computePipelines
  assert.deepEqual(none!.compute.constants, { CLASS_KEY: 0, FEEDBACK: 1 })
  assert.deepEqual(one!.compute.constants, { CLASS_KEY: HAS_UV, CLASS_BIN: first, FEEDBACK: 1 })
  assert.equal(two!.compute.constants!.CLASS_KEY, HAS_UV | HAS_VERTEX_NORMAL)
  assert.equal(none!.compute.module, plain, 'a class of the features keeps the shared module')
  const code = (one!.compute.module as unknown as { code: string }).code
  assert.equal(code, shadeShader({ graph: program.compiled }))
  assert.equal(one!.compute.module, two!.compute.module, 'the classes of one program share it')
})
