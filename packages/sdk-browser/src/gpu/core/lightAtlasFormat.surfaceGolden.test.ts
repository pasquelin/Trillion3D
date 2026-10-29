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
  fieldShadowKernels,
  fieldShadowMeshKernel,
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
// SURFACE_CACHE_RADIOSITY_FILTER_WGSL is re-pinned: the radiosity's filter lists the declarations its kernels share (`radiosityKernelDeclarations`) before its own, so they come in another order; the declarations are the same.
// Re-pinned 29/10 for the traces the morning's sweeps changed: their shared text, not the surface cache's word format.
// Re-pinned 29/10 for the march's hit, which names the object of the grid whose cards lit it (`ScHitSurface.instance`): every trace that reads a hit of the field.
const WORD_PROGRAMS = {
  REFLECTION_TRACE_SHADER: 'ee2e15047ee152a9',
  REFLECTION_TRACE_STATISTICS_SHADER: '2412931fde84306d',
  SURFACE_CACHE_RESOLVE_WGSL: '3d49d6105d5fd6bf',
  SURFACE_CACHE_RESAMPLE_WGSL: '718df4696635dbd6',
  SURFACE_CACHE_RESAMPLE_COMPRESSED_WGSL: '07e6174f45994148',
  SURFACE_CACHE_RESAMPLE_LIGHTING_WGSL: 'f07b7abc1b63366b',
  SURFACE_CACHE_RESAMPLE_LIGHTING_COMPRESSED_WGSL: 'e2bc788adda530f4',
  SURFACE_CACHE_COPY_WGSL: 'b7911e82d61f6103',
  SURFACE_CACHE_COPY_COMPRESSED_WGSL: 'c51c2bfeced1892c',
  SURFACE_CACHE_LIGHTS_WGSL: 'b4e653e9141b0662',
  SURFACE_CACHE_ENCODE_WGSL: '698e60b9e535debe',
  SURFACE_CACHE_CLEAR_BLOCKS_WGSL: '16ab7759053daabd',
  SURFACE_CACHE_ATLAS_VIEW_WGSL: '703f205f47d1b706',
  SURFACE_CACHE_FEEDBACK_COMPACTION_SHADER: 'd7d88317e54f0487',
  SURFACE_CACHE_CONTEXT_WGSL: '1ceaa8e59f4bdf3b',
  SURFACE_CACHE_SPLICE_WGSL: '4771140dcf5c0bd1',
  SURFACE_CACHE_DIRECT_WGSL: '27a965b4c0c15aeb',
  SURFACE_CACHE_DIRECT_COLOURED_WGSL: '43e88a67e6ef36dc',
  SURFACE_CACHE_SHADOW_MASK_WGSL: 'e13a6f4e79dd580a',
  SURFACE_CACHE_SHADOW_MASK_COLOURED_WGSL: '445af088824c2dc6',
  SURFACE_CACHE_SHADOW_ARGS_WGSL: 'e748644cfeec6aa4',
  SURFACE_CACHE_SHADOW_TRACE_WGSL: 'ce9aa39a023f9304',
  SURFACE_CACHE_SHADOW_TRACE_COLOURED_WGSL: '64e4db162dc5b6b7',
  SURFACE_CACHE_STOCHASTIC_GENERATE_WGSL: 'e1897fd201bdfb04',
  SURFACE_CACHE_STOCHASTIC_COMPACT_WGSL: '63623ec4c29fa2bf',
  SURFACE_CACHE_STOCHASTIC_COMPACT_COLOURED_WGSL: 'b94d4f827513a8f9',
  SURFACE_CACHE_STOCHASTIC_SHADE_WGSL: '20a00ff1366b5643',
  SURFACE_CACHE_STOCHASTIC_SHADE_COLOURED_WGSL: 'd9ab808588189017',
  SURFACE_CACHE_STOCHASTIC_TEMPORAL_WGSL: 'a56b3f99563278ab',
  SURFACE_CACHE_RADIOSITY_BUILD_WGSL: '3cd762d737dc1f1d',
  SURFACE_CACHE_RADIOSITY_TRACE_WGSL: 'b563a38e3752abdd',
  SURFACE_CACHE_RADIOSITY_TRACED_WGSL: '1b204ae05798896d',
  SURFACE_CACHE_RADIOSITY_FILTER_WGSL: '3ea2afcd4daba370',
  SURFACE_CACHE_RADIOSITY_INTEGRATE_WGSL: 'c8b9737509d51495',
  SURFACE_CACHE_TILE_DEPTH_RANGE: '4c5ec16d5eb973a9',
  SURFACE_CACHE_CULL: '9d9cc558a92e0b8b',
  SURFACE_CACHE_LIGHT_TILE_COUNTS: '0637a1d86f091a1b',
  SURFACE_CACHE_LIGHT_TILE_COMPACT: '3f284a690974065a',
  SURFACE_CACHE_COMBINE: 'ea6e1e372eb3d0e2',
  SURFACE_CACHE_COMBINE_COMPRESSED: 'a201efe327f6d6c7',
  TRANSLUCENCY_GI_TRACE: 'beb3b9084551952f',
  TRANSLUCENCY_GI_TRACE_PACKED: '40b503d865ad009b',
  REFLECTION_TRACE_HARDWARE_SHADER: 'd5017173c41f84fa',
  REFLECTION_TRACE_NATIVE_SHADER: '2ef3d0aea42992e5',
  REFLECTION_TRACE_NATIVE_STATISTICS_SHADER: '2466f2a03bc293fa',
  REFLECTION_TRACE_POLYFILL_SHADER: 'a818d73624f23ae4',
  REFLECTION_TRACE_POLYFILL_STATISTICS_SHADER: 'b36fc642e7dd4ca8',
  CACHE_TRACED_PROGRAM: 'f56969f44362fbe9',
  CACHE_TRACE_PROGRAM: 'a521be1163dacc40',
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
    layoutsField: layoutsOf((d) => {
      fieldShadowKernels(d, 'grey')
      fieldShadowMeshKernel(d, 'grey')
    }),
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
  // traced radiance): the surface cache's own programs unchanged. Re-pinned after c9's deduplication sweeps of 29/10: the shared helpers
  // (table words, depth, segment-box span, vignette, held layers) declared once, the same operations; the direct mesh pass's layout lost the
  // view cascade's subsurface colour, which only its transmission read, never on for the cards.
  // Re-pinned for the shadows through the distance fields (30/10): the direct light reads the masks alone (no light function, cloud, profile or field
  // binding, no ray of its own), the shadow trace's text is shared with the passes of `fieldShadowWgsl.ts` (the byte answered by `traceAnswer`), and the
  // direct mesh pass's layout gave way to those passes' (`layoutsField`); the traced shadows' layouts (`layoutsShadow`) are unchanged.
  assert.deepEqual(recorded(), {
    layoutsFixedGrey: 'e4010dec0611a24a',
    layoutsFixedColour: 'e4010dec0611a24a',
    layoutsField: 'c8a19d87e4b66a9d',
    layoutsShadow: 'a8a157471c8e7cd3',
    layoutsRadiosityTraced: 'e86279f8aa04f1bd',
    layoutsShaped: 'b6ac6fd920be7f38',
    layoutsStochastic: '1896c80f0db5a6a6',
    layoutsCapture: '6f12f59be6e73943',
    atlasesfalse: '258f71d26e8c25c8',
    atlasestrue: 'f402ebe2d203e0d1',
  })
})
