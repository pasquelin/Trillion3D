// The reflections', the depth pyramid's, the cut's, the decode's, the bins' and the surface cache's kernels fit
// WebGPU's default limits as the lighting's and the blends' programs do (`stageLimits.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createReflectionPipelines,
  hardwareReflectionKernels,
  reflectionSceneLayout,
  reflectionLayout,
} from '../../lighting/reflections/reflectionPipelines.ts'
import { hitLightingKernels } from '../../lighting/reflections/hitLighting/kernels.ts'
import { createHizPipelines } from '../../visibility/hiz/gpu/pipelines.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { dagBindEntries } from '../../geometry/dag/shader/bindings.ts'
import { createGpuDecode } from '../../visibility/decode/decode.ts'
import { createBinStages } from '../../visibility/bins/bins.ts'
import { createClusterMeasure } from '../../geometry/dag/info/measure.ts'
import { createDeformationCompute } from '../../deformation/compute.ts'
import { dagDeviceRefusal } from '../../geometry/dag/deviceRefusal.ts'
import { cameraCutBuffers } from '../../geometry/dag/bufferTable.ts'
import type { PackedDag } from '../../geometry/dag/types.ts'
import { TREE_REFIT_WGSL } from '../../geometry/dag/tree/treeRefitWgsl.ts'
import { TREE_LEAVES_WGSL } from '../../placement/tree/treeLeavesWgsl.ts'
import { ROOT_BOXES_WGSL } from '../../placement/roots/rootBoxesWgsl.ts'
import { COMPOSE_ROOTS_WGSL, COMPOSE_WORLDS_WGSL } from '../../placement/compose/gpuComposeWgsl.ts'
import { wgslComputeLayout } from './wgslBindings.fixture.ts'
import { storageBufferCount, withinDefaults } from './stageLimits.fixture.ts'
import { MESH_SUN_STORAGE_BUFFERS } from '../../lighting/surfaceCache/lighting/meshShadowWgsl.ts'
import { RAY_QUERY_WGSL } from '../../lighting/rays/rayQueryWgsl.ts'
import { DEFORM_INDEX_SHADER } from '../../lighting/rays/deformIndexWgsl.ts'
import { SCENE_TRACE_PROBE } from '../../lighting/rays/sceneTrace/sceneTraceProbe.fixture.ts'
import { createCaptureKernels } from '../../lighting/surfaceCache/copy.ts'
import { createAtlasViewer } from '../../lighting/surfaceCache/debug.ts'
import { CLEAR_BLOCKS_WGSL, ENCODE_WGSL } from '../../lighting/surfaceCache/compressWgsl.ts'
import {
  COPY_COMPRESSED_WGSL,
  COPY_WGSL,
  lightsProgramOf,
  resampleProgramOf,
  resampleLightingProgramOf,
  RESOLVE_WGSL,
} from '../../lighting/surfaceCache/copyWgsl.ts'
import {
  fieldShadowKernels,
  fieldShadowMeshKernel,
  fixedKernels,
  shapedKernels,
  tracedRadiosityKernels,
  tracedShadowKernels,
} from '../../lighting/surfaceCache/lighting/kernels.ts'
import { probeLitKey, probeLitMaker } from '../../lighting/bounce/screen/hitLitKernels.ts'
import { NO_SCENE_MASKS } from '../../lighting/rays/sceneTrace/sceneMaskPrograms.ts'
import { cacheLitMaker } from '../../lighting/bounce/cache/cacheHitLitKernels.ts'
import { tracedCacheKernels } from '../../lighting/bounce/cache/cacheKernels.ts'
import { WORD_LIGHT_FORMAT } from './lightAtlasFormat.ts'
import {
  cacheSplatProgramOf,
  cacheTracedProgramOf,
} from '../../lighting/bounce/cache/cacheTraceWgsl.ts'
import { cacheFixupProgram } from '../../lighting/bounce/cache/cacheFixupWgsl.ts'
import { SCENE_CULL_WGSL } from '../../lighting/rays/sceneTrace/sceneCullWgsl.ts'
import {
  kernelShapeOf,
  screenProbeSources,
  tracedSceneKernel,
} from '../../lighting/bounce/screen/kernels.ts'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { SURFACE_CACHE_SHADERS as S } from './engineShaders.surfaceCache.fixture.ts'
const RESAMPLE_WGSL = resampleProgramOf(false, WORD_LIGHT_FORMAT)
const RESAMPLE_COMPRESSED_WGSL = resampleProgramOf(true, WORD_LIGHT_FORMAT)
const RESAMPLE_LIGHTING_WGSL = resampleLightingProgramOf(false, WORD_LIGHT_FORMAT)
const RESAMPLE_LIGHTING_COMPRESSED_WGSL = resampleLightingProgramOf(true, WORD_LIGHT_FORMAT)
const LIGHTS_WGSL = lightsProgramOf(WORD_LIGHT_FORMAT)
const CACHE_FIXUP_PROGRAM = cacheFixupProgram(WORD_LIGHT_FORMAT)
const CACHE_TRACED_PROGRAM = cacheTracedProgramOf(WORD_LIGHT_FORMAT)
const CACHE_SPLAT_PROGRAM = cacheSplatProgramOf(WORD_LIGHT_FORMAT)

test("the reflections' and the depth pyramid's kernels fit WebGPU's defaults", async () => {
  const { device, pipelineLayouts: layouts } = fakeDevice()
  // The trace binds the reflection group (`reflectionLayout`) beside its own: the radiance
  // pyramid one texture, level 0 its opaque and front depths in one (`hizDepthEntries`).
  assert.ok(await createReflectionPipelines(device), 'the reflection kernels build')
  assert.ok(await createHizPipelines(device), 'the depth pyramid kernels build')
  withinDefaults(layouts, 'the reflections and the depth pyramid')
})

test("the reflections' scene stage through the scene's triangles fits WebGPU's defaults: the trace of its rays (the cut's tables, the reflection group, the scene trace with its any-hit test) and its answer (the cache, the fog, the reflection group, the scene trace)", () => {
  const { device, pipelineLayouts: layouts } = fakeDevice()
  hardwareReflectionKernels(device, WORD_LIGHT_FORMAT)
  assert.equal(layouts.length, 2)
  withinDefaults(layouts, 'the reflection scene stage through the scene triangles')
})

test("the reflections' hit lighting fits WebGPU's defaults: the scene stage with its marking, the compaction, the sort and the two lit passes (eight storage buffers each at most)", () => {
  const { device, pipelineLayouts: layouts } = fakeDevice()
  hardwareReflectionKernels(device, WORD_LIGHT_FORMAT, undefined, true)
  hitLightingKernels(device, WORD_LIGHT_FORMAT)
  // The trace and its answer, then the compaction, its dispatch, the copy, the sort's arguments and the sort, and the first and second passes of both surfaces.
  assert.equal(layouts.length, 2 + 5 + 4)
  withinDefaults(layouts, 'the reflection hit lighting')
  for (const layout of layouts.slice(-4))
    assert.ok(
      (storageBufferCount(layout) ?? 0) <= 8,
      'a lit pass binds at most eight storage buffers',
    )
})

test("the cut's programs fit WebGPU's default limits, whatever the world", () => {
  // The culling's one layout, whatever the device splits nothing: its tables are record tables.
  withinDefaults([{ bindGroupLayouts: [{ entries: dagBindEntries() }] as never }], 'the culling')
  for (const [name, text] of [
    ['the refit', TREE_REFIT_WGSL],
    ['the tree leaves', TREE_LEAVES_WGSL],
    ['the root boxes', ROOT_BOXES_WGSL],
    ['the compose roots', COMPOSE_ROOTS_WGSL],
    ['the compose worlds', COMPOSE_WORLDS_WGSL],
    // The ray query reads the cut's nodes, frame words, worlds and tree where the culling reads
    // them, at its bindings: four sampled textures, whatever the world's size.
    ['the ray trace', RAY_QUERY_WGSL],
    ['the deformation index', DEFORM_INDEX_SHADER],
    // The scene trace reads the same four tables, and binds three storage buffers and a uniform of its own.
    ['the scene trace', SCENE_TRACE_PROBE],
  ] as const)
    withinDefaults([wgslComputeLayout(text)], name)
})

test('a device whose binding holds the cut’s largest buffer binds the cut at the defaults', () => {
  // The binding-limit proof's narrow case (`tests/gpu/dag/frame-ranges.gpu.ts`): its binding holds
  // the clusters' records of a thousand pages, 44 bytes a page and the largest buffer the cut binds,
  // and `work` whole: 376 bytes for a thousand pages — two masks of sixteen blocks of two words,
  // twenty-nine frame counters and the lists' group words (`dagWorkLayout`).
  const packed = {
    pageCount: 1000,
    nodeCount: 10,
    worldCount: 600,
    ...Object.fromEntries(
      ['clusters', 'nodes', 'worlds', 'coldWords'].map((name) => [name, new Float32Array(16)]),
    ),
  } as unknown as PackedDag
  // Every other limit at WebGPU's default: the check reads a limit the device leaves out as such.
  const largest = Math.max(...Object.values(cameraCutBuffers(packed).rows).map((row) => row.size))
  const limits = { maxStorageBufferBindingSize: largest }
  assert.equal(dagDeviceRefusal(limits, packed), undefined, 'the device holds the cut')
  withinDefaults([{ bindGroupLayouts: [{ entries: dagBindEntries() }] as never }], 'its culling')
})

test("the decode, the bins, the measure and the deformation fit WebGPU's default limits", async () => {
  // The decode and its plan, the bins' four kernels and the measure's, each on a layout of its own.
  const { device, pipelineLayouts: layouts } = fakeDevice()
  createGpuDecode(device)
  createBinStages(device, 1)
  createClusterMeasure(device).ask()
  await createDeformationCompute(device)
  withinDefaults(layouts, 'the decode, the bins, the measure and the deformation')
})

test("the surface cache's capture kernels and atlas view fit WebGPU's default limits", () => {
  // The kernels of an atlas, plain and compressed, and the viewer are built on their own layouts; the
  // programs declare, beside, every binding they name — the resamples' read library holds layers they never
  // read, the clear of the blocks the pages' lists it does not use.
  const { device, pipelineLayouts: layouts } = fakeDevice()
  const kernels = [false, true].map((compressed) =>
    createCaptureKernels(device, compressed, WORD_LIGHT_FORMAT),
  )
  createAtlasViewer(device)
  withinDefaults(layouts, 'the surface cache')
  for (const [name, text] of [
    ['the resolve', RESOLVE_WGSL],
    ['the resample', RESAMPLE_WGSL],
    ['the resample of a compressed atlas', RESAMPLE_COMPRESSED_WGSL],
    ['the resample of the light', RESAMPLE_LIGHTING_WGSL],
    ['the resample of the light of a compressed atlas', RESAMPLE_LIGHTING_COMPRESSED_WGSL],
    ['the copy', COPY_WGSL],
    ['the copy of a compressed atlas', COPY_COMPRESSED_WGSL],
    ['the encoders of the blocks', ENCODE_WGSL],
    ['the clear of the blocks', CLEAR_BLOCKS_WGSL],
    ['the lights', LIGHTS_WGSL],
  ] as const)
    withinDefaults([wgslComputeLayout(text)], name)
  for (const set of kernels) set.dispose()
})

test("the suns' shadow through the meshes' fields fits the storage buffers a device that grants ten has", () => {
  // The pass that traces the suns binds the lists (one buffer) and the fields (four) beside its five (the tables, the light tiles' counters, the light tiles, the masks and the lights).
  // A device that grants less shadows the suns through the global field (`MESH_SUN_STORAGE_BUFFERS`).
  const granted = { maxStorageBuffersPerShaderStage: MESH_SUN_STORAGE_BUFFERS }
  const { device, pipelineLayouts: layouts } = fakeDevice({ limits: granted })
  fieldShadowMeshKernel(device, 'grey')
  fieldShadowMeshKernel(device, 'colour')
  fieldShadowKernels(device, 'grey')
  assert.ok(layouts.length > 0)
  for (const layout of layouts)
    assert.ok((storageBufferCount(layout) ?? 0) <= MESH_SUN_STORAGE_BUFFERS)
  assert.equal(
    Math.max(...layouts.map((layout) => storageBufferCount(layout) ?? 0)),
    MESH_SUN_STORAGE_BUFFERS,
  )
})

test("the surface cache's lighting kernels fit WebGPU's default limits", () => {
  // The kernels are built on their own layouts, the ray of the radiosity binding the cache's read library, the
  // global field, the sky and the object grid: the most of any program of the cache. The programs declare, beside,
  // every binding they name, those the layouts leave out — two layers a trace never reads — counted too.
  const { device, pipelineLayouts: layouts } = fakeDevice({
    features: ['texture-formats-tier1'],
  })
  // The light stored in each of its formats: the layers a pass binds change their sample type and storage format, never their count.
  for (const light of ['r32uint', 'rg11b10ufloat', 'rgba16float', 'rgba32float'] as const) {
    fixedKernels(device, 'grey', light)
    fixedKernels(device, 'colour', light)
    tracedRadiosityKernels(device, light)
    shapedKernels(device, 8, false, light)
    shapedKernels(device, 8, true, light)
  }
  // The kernels that cast rays through triangles, the shadows' and the radiosity's: the trace binds the scene trace's group
  // beside its own, its own with the cut's tables.
  tracedShadowKernels(device, 'grey')
  tracedShadowKernels(device, 'colour')
  withinDefaults(layouts, 'the surface cache lighting')
  for (const [name, text] of [
    ['the update context', S.SURFACE_CACHE_CONTEXT_WGSL],
    ['the pages cut into tiles', S.SURFACE_CACHE_SPLICE_WGSL],
    ['the depth ranges of the tiles', S.SURFACE_CACHE_TILE_DEPTH_RANGE],
    ['the lights of the tiles', S.SURFACE_CACHE_CULL],
    ['the counters of the light tiles', S.SURFACE_CACHE_LIGHT_TILE_COUNTS],
    ['the light tiles compacted', S.SURFACE_CACHE_LIGHT_TILE_COMPACT],
    ['the direct light', S.SURFACE_CACHE_DIRECT_WGSL],
    ['the direct light over coloured masks', S.SURFACE_CACHE_DIRECT_COLOURED_WGSL],
    ['the shadow masks', S.SURFACE_CACHE_SHADOW_MASK_WGSL],
    [
      'the shadow masks of a light function apart from the atlas',
      S.SURFACE_CACHE_SHADOW_MASK_STANDALONE_WGSL,
    ],
    ['the same, over a map and coloured masks', S.SURFACE_CACHE_SHADOW_MASK_STANDALONE_MAPPED_WGSL],
    ['the shadow masks of the coloured atlas', S.SURFACE_CACHE_SHADOW_MASK_COLOURED_WGSL],
    ['the shadow trace arguments', S.SURFACE_CACHE_SHADOW_ARGS_WGSL],
    ['the shadow trace', S.SURFACE_CACHE_SHADOW_TRACE_WGSL],
    ['the shadow trace over coloured masks', S.SURFACE_CACHE_SHADOW_TRACE_COLOURED_WGSL],
    ['the final light', S.SURFACE_CACHE_COMBINE],
    ['the final light of a compressed atlas', S.SURFACE_CACHE_COMBINE_COMPRESSED],
    ['the radiosity tiles', S.SURFACE_CACHE_RADIOSITY_BUILD_WGSL],
    ['the radiosity trace', S.SURFACE_CACHE_RADIOSITY_TRACE_WGSL],
    ['the radiosity trace through triangles', S.SURFACE_CACHE_RADIOSITY_TRACED_WGSL],
    ['the radiosity filter and harmonics', S.SURFACE_CACHE_RADIOSITY_FILTER_WGSL],
    ['the radiosity integration', S.SURFACE_CACHE_RADIOSITY_INTEGRATE_WGSL],
  ] as const)
    withinDefaults([wgslComputeLayout(text)], name)
})

test("the radiance cache's trace through the scene's triangles fits WebGPU's default limits: its group with the cut's tables, the scene trace's beside", () => {
  const { device, pipelineLayouts: layouts } = fakeDevice()
  tracedCacheKernels(device, WORD_LIGHT_FORMAT)
  withinDefaults(layouts, 'the radiance cache traced kernels')
  withinDefaults([wgslComputeLayout(CACHE_TRACED_PROGRAM)], 'the radiance cache traced trace')
})

test("the radiance cache's hit lighting fits WebGPU's default limits: the trace that marks the hits, the compaction, the list's passes, the two lit passes (eight storage buffers each at most)", () => {
  const { device, pipelineLayouts: layouts } = fakeDevice()
  cacheLitMaker(device, WORD_LIGHT_FORMAT)(NO_SCENE_MASKS)
  withinDefaults(layouts, 'the radiance cache hit lighting')
  for (const layout of layouts)
    assert.ok((storageBufferCount(layout) ?? 0) <= 8, 'a pass binds at most eight storage buffers')
})

test("the radiance cache's spread of the trace atlas and its final maps fit WebGPU's default limits: the fixup writes four storage textures", () => {
  withinDefaults([wgslComputeLayout(CACHE_SPLAT_PROGRAM)], 'the radiance cache spread')
  withinDefaults([wgslComputeLayout(CACHE_FIXUP_PROGRAM)], 'the radiance cache fixup')
})

test("the screen probes' scene stage through the scene's triangles fits WebGPU's default limits, with the fog on its rays or not: its group with the cut's tables, the reflection group the scene stages read, the scene trace's", () => {
  const { device, pipelineLayouts: layouts } = fakeDevice()
  tracedSceneKernel(device, {
    side: 8,
    samples: [4, 4],
    heightFog: false,
    light: WORD_LIGHT_FORMAT,
  })
  tracedSceneKernel(device, { side: 8, samples: [4, 4], heightFog: true, light: WORD_LIGHT_FORMAT })
  withinDefaults(layouts, 'the screen probes traced scene stage')
})

test("the screen probes' hit lighting fits WebGPU's default limits, with the fog on the rays or not: the stage that marks the hits, the compaction, the list's passes, the two lit passes (eight storage buffers each at most)", () => {
  for (const heightFog of [false, true]) {
    const { device, pipelineLayouts: layouts } = fakeDevice()
    const shape = { side: 8, samples: [4, 4] as const, heightFog, light: WORD_LIGHT_FORMAT }
    probeLitMaker(device, probeLitKey(shape))(NO_SCENE_MASKS)
    withinDefaults(layouts, 'the screen probes hit lighting')
    for (const layout of layouts)
      assert.ok(
        (storageBufferCount(layout) ?? 0) <= 8,
        'a pass binds at most eight storage buffers',
      )
  }
})

test("the scene trace's culling pass fits WebGPU's default limits: the cut's tables in group 0, its parameters and the table it writes in group 1", () => {
  withinDefaults([wgslComputeLayout(SCENE_CULL_WGSL)], 'the scene trace culling')
})

test("every kernel of the screen probes fits WebGPU's default limits at the levels that cast, with the extra occlusion, the filter of the probes, the levels of the gather and the fog on the rays on, the integration reduced or not, its tiles classified or the integral numerical: its group with the reflection group", () => {
  const { device } = fakeDevice()
  const group = reflectionLayout(device)
  const sceneGroup = reflectionSceneLayout(device)
  for (const screenProbes of ['ultra', 'cinematic'] as const)
    for (const [screenProbeIntegrateDownsampleFactor, screenProbeDiffuseIntegralMethod] of [
      [1, 0],
      [2, 1],
      [2, 2],
    ]) {
      const shape = kernelShapeOf(
        screenProbeSettings({
          screenProbes,
          screenProbeExtraAmbientOcclusion: true,
          screenProbeTemporalFilterProbes: true,
          screenProbeGatherNumMips: 2,
          screenProbeHeightFogOnGI: true,
          screenProbeIntegrateDownsampleFactor,
          screenProbeDiffuseIntegralMethod,
        }),
      )
      for (const [name, source] of Object.entries(screenProbeSources(shape)))
        withinDefaults(
          [
            {
              bindGroupLayouts: [
                { entries: [...source.entries] },
                source.scene ? sceneGroup : group,
              ] as never,
            },
          ],
          `the screen probes' ${name} at ${screenProbes}, the integration reduced ${screenProbeIntegrateDownsampleFactor}, integral method ${screenProbeDiffuseIntegralMethod}`,
        )
    }
})
