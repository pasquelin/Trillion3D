// The reflections', the depth pyramid's, the cut's, the decode's, the bins' and the surface cache's kernels fit
// WebGPU's default limits as the lighting's and the blends' programs do (`stageLimits.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createReflectionPipelines } from '../../lighting/reflections/reflectionPipelines.ts'
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
import { withinDefaults } from './stageLimits.fixture.ts'
import { RAY_QUERY_WGSL } from '../../lighting/rays/rayQueryWgsl.ts'
import { DEFORM_INDEX_SHADER } from '../../lighting/rays/deformIndexWgsl.ts'
import { createCaptureKernels } from '../../lighting/surfaceCache/copy.ts'
import { createAtlasViewer } from '../../lighting/surfaceCache/debug.ts'
import { CLEAR_BLOCKS_WGSL, ENCODE_WGSL } from '../../lighting/surfaceCache/compressWgsl.ts'
import {
  COPY_COMPRESSED_WGSL,
  COPY_WGSL,
  LIGHTS_WGSL,
  RESAMPLE_COMPRESSED_WGSL,
  RESAMPLE_WGSL,
  RESOLVE_WGSL,
} from '../../lighting/surfaceCache/copyWgsl.ts'
import { shapedKernels, staticKernels } from '../../lighting/surfaceCache/lighting/kernels.ts'
import { combineWgsl } from '../../lighting/surfaceCache/lighting/combineWgsl.ts'
import { CONTEXT_WGSL } from '../../lighting/surfaceCache/lighting/contextWgsl.ts'
import { cullWgsl } from '../../lighting/surfaceCache/lighting/cullWgsl.ts'
import { DIRECT_WGSL } from '../../lighting/surfaceCache/lighting/directWgsl.ts'
import { RADIOSITY_BUILD_WGSL } from '../../lighting/surfaceCache/lighting/radiosityBuildWgsl.ts'
import { RADIOSITY_FILTER_WGSL } from '../../lighting/surfaceCache/lighting/radiosityFilterWgsl.ts'
import { RADIOSITY_INTEGRATE_WGSL } from '../../lighting/surfaceCache/lighting/radiosityIntegrateWgsl.ts'
import { RADIOSITY_TRACE_WGSL } from '../../lighting/surfaceCache/lighting/radiosityTraceWgsl.ts'

test("the reflections' and the depth pyramid's kernels fit WebGPU's defaults", async () => {
  const { device, pipelineLayouts: layouts } = fakeDevice()
  // The trace binds the reflection group (`reflectionLayout`) beside its own: the radiance
  // pyramid one texture, level 0 its opaque and front depths in one (`hizDepthEntries`).
  assert.ok(await createReflectionPipelines(device), 'the reflection kernels build')
  assert.ok(await createHizPipelines(device), 'the depth pyramid kernels build')
  withinDefaults(layouts, 'the reflections and the depth pyramid')
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
  // programs declare, beside, every binding they name — the resample's read library holds three layers
  // of light it never reads, the clear of the blocks the pages' lists it does not use.
  const { device, pipelineLayouts: layouts } = fakeDevice()
  const kernels = [false, true].map((compressed) => createCaptureKernels(device, compressed))
  createAtlasViewer(device)
  withinDefaults(layouts, 'the surface cache')
  for (const [name, text] of [
    ['the resolve', RESOLVE_WGSL],
    ['the resample', RESAMPLE_WGSL],
    ['the resample of a compressed atlas', RESAMPLE_COMPRESSED_WGSL],
    ['the copy', COPY_WGSL],
    ['the copy of a compressed atlas', COPY_COMPRESSED_WGSL],
    ['the encoders of the blocks', ENCODE_WGSL],
    ['the clear of the blocks', CLEAR_BLOCKS_WGSL],
    ['the lights', LIGHTS_WGSL],
  ] as const)
    withinDefaults([wgslComputeLayout(text)], name)
  for (const set of kernels) set.dispose()
})

test("the surface cache's lighting kernels fit WebGPU's default limits", () => {
  // The kernels are built on their own layouts, the ray of the radiosity binding the cache's read library, the
  // global field, the sky and the object grid: the most of any program of the cache. The programs declare, beside,
  // every binding they name, those the layouts leave out — two layers a trace never reads — counted too.
  const { device, pipelineLayouts: layouts } = fakeDevice()
  staticKernels(device)
  shapedKernels(device, 8, false)
  shapedKernels(device, 8, true)
  withinDefaults(layouts, 'the surface cache lighting')
  for (const [name, text] of [
    ['the update context', CONTEXT_WGSL],
    ['the lights of the tiles', cullWgsl(8)],
    ['the direct light', DIRECT_WGSL],
    ['the final light', combineWgsl(false)],
    ['the final light of a compressed atlas', combineWgsl(true)],
    ['the radiosity tiles', RADIOSITY_BUILD_WGSL],
    ['the radiosity trace', RADIOSITY_TRACE_WGSL],
    ['the radiosity filter and harmonics', RADIOSITY_FILTER_WGSL],
    ['the radiosity integration', RADIOSITY_INTEGRATE_WGSL],
  ] as const)
    withinDefaults([wgslComputeLayout(text)], name)
})
