// The surface cache and the passes that read its light, in the word format, write the text, layouts and textures they held before `lightingDataFormat` moved them: golden digests taken before the setting reached them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  cacheTracedProgramOf,
  cacheTraceProgramOf,
} from '../../lighting/bounce/cache/cacheTraceWgsl.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { ENGINE_SHADERS } from './engineShaders.fixture.ts'
import { ensureSurfaceAtlases } from '../../lighting/surfaceCache/atlases.ts'
import { createCaptureKernels } from '../../lighting/surfaceCache/copy.ts'
import {
  directMeshKernel,
  fixedKernels,
  shapedKernels,
  stochasticKernels,
  tracedRadiosityKernels,
  tracedShadowKernels,
} from '../../lighting/surfaceCache/lighting/kernels.ts'
import { WORD_LIGHT_FORMAT } from './lightAtlasFormat.ts'
const CACHE_TRACE_PROGRAM = cacheTraceProgramOf(WORD_LIGHT_FORMAT)
const CACHE_TRACED_PROGRAM = cacheTracedProgramOf(WORD_LIGHT_FORMAT)

const digest = (value: unknown) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex')
    .slice(0, 16)

/** Every text of the surface cache and of the passes whose rays read its light at their hits, keyed by name in `ENGINE_SHADERS`, as the passes held it before the setting existed. */
// The seven REFLECTION_TRACE_* digests are re-pinned: the front layer's traced format went from rg32uint to rgba32uint and the bilateral pass writes the front depth in its third word (`frontLayer.ts`, `bilateralWgsl.ts`, `viewLayout.ts`). Rebuilt on those files as they were at HEAD, the programs give the old digests exactly, so the surface cache's word format left their text as it was.
// Re-pinned again after other agents changed shared libraries these programs include, none of them in the surface cache: the direct-lights struct and its GGX energy table (frame/backend/state/lightBufferLayout.ts), the shared `sinFromCosUnclamped` helper (lighting/direct/lightDrawWgsl.ts), the virtual-texture `colorFetch` footprint and `entryLevel` (materials/texture/samplingFootprint.ts), the sky cube's face permutation tables (modules/sky/skyLight/cubeWgsl.ts), the depth pyramid's `hizFoldOf`/`hizCellFurthest` and the screen probe's tile word (bounce/screen), plus the front layer's traced format. The cull's group maximum is reduced by `workgroupSumLoop` (the shared de-duplication P1-13, the same computation). The surface cache's own programs are otherwise unchanged.
const WORD_PROGRAMS = {
  REFLECTION_TRACE_SHADER: 'e06a6de0b2a37977',
  REFLECTION_TRACE_STATISTICS_SHADER: '06e1eebfeadec964',
  SURFACE_CACHE_RESOLVE_WGSL: '4aa172c48ce64025',
  SURFACE_CACHE_RESAMPLE_WGSL: '95b3d12eaf68879e',
  SURFACE_CACHE_RESAMPLE_COMPRESSED_WGSL: 'c315be0f5b2fc865',
  SURFACE_CACHE_RESAMPLE_LIGHTING_WGSL: 'f4192016c3a46498',
  SURFACE_CACHE_RESAMPLE_LIGHTING_COMPRESSED_WGSL: '407da33aeed3d4ba',
  SURFACE_CACHE_COPY_WGSL: 'b7911e82d61f6103',
  SURFACE_CACHE_COPY_COMPRESSED_WGSL: 'c51c2bfeced1892c',
  SURFACE_CACHE_LIGHTS_WGSL: '8f26bbabb4fedcaa',
  SURFACE_CACHE_ENCODE_WGSL: '698e60b9e535debe',
  SURFACE_CACHE_CLEAR_BLOCKS_WGSL: '16ab7759053daabd',
  SURFACE_CACHE_ATLAS_VIEW_WGSL: '703f205f47d1b706',
  SURFACE_CACHE_FEEDBACK_COMPACTION_SHADER: 'd7d88317e54f0487',
  SURFACE_CACHE_CONTEXT_WGSL: '7988082ea1a0f66e',
  SURFACE_CACHE_SPLICE_WGSL: '675552343eaed089',
  SURFACE_CACHE_DIRECT_WGSL: 'cd94ac39a4f2dba9',
  SURFACE_CACHE_DIRECT_COLOURED_WGSL: 'fcf11ae24b67f8be',
  SURFACE_CACHE_LIGHT_FUNCTION_PASS_WGSL: '9e41fbe79559698b',
  SURFACE_CACHE_LIGHT_FUNCTION_PASS_MAPPED_WGSL: '52715af27d947ff6',
  SURFACE_CACHE_SHADOW_MASK_WGSL: 'd23041439b65778d',
  SURFACE_CACHE_SHADOW_MASK_COLOURED_WGSL: '76573a1aa2a86bad',
  SURFACE_CACHE_SHADOW_ARGS_WGSL: '97fc836cd2000a6f',
  SURFACE_CACHE_SHADOW_TRACE_WGSL: '62154974e28d2b54',
  SURFACE_CACHE_SHADOW_TRACE_COLOURED_WGSL: 'a2825f114730532e',
  SURFACE_CACHE_STOCHASTIC_GENERATE_WGSL: '77bc1f69fa8e2063',
  SURFACE_CACHE_STOCHASTIC_COMPACT_WGSL: '96d87aeb9386b505',
  SURFACE_CACHE_STOCHASTIC_COMPACT_COLOURED_WGSL: 'ec4006b6318c2545',
  SURFACE_CACHE_STOCHASTIC_SHADE_WGSL: 'a087f193dc71ea0b',
  SURFACE_CACHE_STOCHASTIC_SHADE_COLOURED_WGSL: '5051fc89600dc048',
  SURFACE_CACHE_STOCHASTIC_TEMPORAL_WGSL: 'c211fe82ef8b8ca5',
  SURFACE_CACHE_RADIOSITY_BUILD_WGSL: '0894c189ef187e5e',
  SURFACE_CACHE_RADIOSITY_TRACE_WGSL: 'c4f13b5aa4e4a437',
  SURFACE_CACHE_RADIOSITY_TRACED_WGSL: '3618186737f78aad',
  SURFACE_CACHE_RADIOSITY_FILTER_WGSL: '899b95fadf6c1e88',
  SURFACE_CACHE_RADIOSITY_INTEGRATE_WGSL: '259a6fd4a3bd36d2',
  SURFACE_CACHE_TILE_DEPTH_RANGE: '726f9fc2fd9f0411',
  SURFACE_CACHE_CULL: 'a17fded85bfdaa6a',
  SURFACE_CACHE_LIGHT_TILE_COUNTS: 'ec31a617765b2ce2',
  SURFACE_CACHE_LIGHT_TILE_COMPACT: '811d31cc268d2303',
  SURFACE_CACHE_COMBINE: '8b73f683c28057c6',
  SURFACE_CACHE_COMBINE_COMPRESSED: 'd2df00728e8a8125',
  TRANSLUCENCY_GI_TRACE: '3ec71206ed6ebaf3',
  TRANSLUCENCY_GI_TRACE_PACKED: 'c423945aaf729239',
  REFLECTION_TRACE_HARDWARE_SHADER: '208d13f2099ed4c6',
  REFLECTION_TRACE_NATIVE_SHADER: '0975a220a77b0c25',
  REFLECTION_TRACE_NATIVE_STATISTICS_SHADER: 'b77398b850538bfd',
  REFLECTION_TRACE_POLYFILL_SHADER: '2831cf3656a96218',
  REFLECTION_TRACE_POLYFILL_STATISTICS_SHADER: 'b01989bab9d366de',
  CACHE_TRACED_PROGRAM: 'd9348b138c3da9bb',
  CACHE_TRACE_PROGRAM: '438bd9955088be50',
}

/** The layouts the surface cache's kernels are made with, and the textures of its atlases, recorded on a device that grants every limit. */
const recorded = () => {
  const limits = {
    maxStorageBuffersPerShaderStage: 64,
    maxStorageTexturesPerShaderStage: 64,
    maxSampledTexturesPerShaderStage: 64,
    maxBindGroups: 8,
    maxBindingsPerBindGroup: 1000,
    maxUniformBuffersPerShaderStage: 32,
  }
  const layoutsOf = (make: (device: GPUDevice) => unknown) => {
    const f = fakeDevice({ limits })
    make(f.device as unknown as GPUDevice)
    return digest(f.bindGroupLayouts.map((layout) => layout.entries))
  }
  const atlasesOf = (compressed: boolean) => {
    const f = fakeDevice()
    ensureSurfaceAtlases(
      undefined,
      f.device as unknown as GPUDevice,
      512,
      256,
      compressed,
      8,
      WORD_LIGHT_FORMAT,
    )
    return digest(f.textures.map((t) => [t.label ?? '', t.size, t.format, t.usage]))
  }
  return {
    layoutsFixedGrey: layoutsOf((d) => fixedKernels(d, 'grey', WORD_LIGHT_FORMAT)),
    layoutsFixedColour: layoutsOf((d) => fixedKernels(d, 'colour', WORD_LIGHT_FORMAT)),
    layoutsDirectMesh: layoutsOf((d) => directMeshKernel(d, 'grey', WORD_LIGHT_FORMAT)),
    layoutsShadow: layoutsOf((d) => tracedShadowKernels(d, 'grey')),
    layoutsRadiosityTraced: layoutsOf((d) => tracedRadiosityKernels(d, WORD_LIGHT_FORMAT)),
    layoutsShaped: layoutsOf((d) => {
      shapedKernels(d, 16, false, WORD_LIGHT_FORMAT)
      shapedKernels(d, 16, true, WORD_LIGHT_FORMAT)
    }),
    layoutsStochastic: layoutsOf((d) => stochasticKernels(d, 'grey', WORD_LIGHT_FORMAT)),
    layoutsCapture: layoutsOf((d) => {
      createCaptureKernels(d, false, WORD_LIGHT_FORMAT)
      createCaptureKernels(d, true, WORD_LIGHT_FORMAT)
    }),
    atlasesfalse: atlasesOf(false),
    atlasestrue: atlasesOf(true),
  }
}

test('the word format writes, in the surface cache and the passes that read it, the text, layouts and textures they held before the setting existed (golden digests)', () => {
  const got = Object.fromEntries(
    Object.keys(WORD_PROGRAMS).map((name) => [name, digest(ENGINE_SHADERS[name])]),
  )
  assert.deepEqual(got, WORD_PROGRAMS)
  // Re-pinned after the cleanup of 28/10 (the cache trace's shared mesh distance-field read, c9's deduplication, the front layer's depth in its
  // traced radiance): the surface cache's own programs unchanged.
  assert.deepEqual(recorded(), {
    layoutsFixedGrey: 'c214b3f82c825c06',
    layoutsFixedColour: 'c214b3f82c825c06',
    layoutsDirectMesh: '3a7a66580d80d561',
    layoutsShadow: 'fa1278f60d251ab4',
    layoutsRadiosityTraced: 'b3c06027e3adf9e1',
    layoutsShaped: 'e0138aa4651fe3cd',
    layoutsStochastic: 'd02fcfa52adabd0f',
    layoutsCapture: '6f12f59be6e73943',
    atlasesfalse: '258f71d26e8c25c8',
    atlasestrue: 'f402ebe2d203e0d1',
  })
})
