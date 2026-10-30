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
const CACHE_TRACE_PROGRAM = cacheTraceProgramOf(WORD_LIGHT_FORMAT, false)
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
// Re-pinned 30/10 for the simple lights' word (the tile slice's walk of the lights past the scene's, `DirectLights.simple`): every program that lists the lights' walk (the surface cache's direct light, shadow masks, shadow and radiosity traces, cull, the reflection traces, the translucency GI trace and the cache traces).
// Re-pinned for the fog beyond a ray worked out over any reach (`fogBeyondAlong`, the sky meshes' capture): the reflection traces, which hold the fog's text.
const WORD_PROGRAMS = {
  REFLECTION_TRACE_SHADER: 'b6e9db89ba090fdb',
  REFLECTION_TRACE_STATISTICS_SHADER: '78ee9c2cfb6a04ce',
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
  SURFACE_CACHE_DIRECT_WGSL: '2cfba0d5c279787f',
  SURFACE_CACHE_DIRECT_COLOURED_WGSL: '44c0e6420a8acd09',
  SURFACE_CACHE_SHADOW_MASK_WGSL: '0883f4cebc9108b3',
  SURFACE_CACHE_SHADOW_MASK_COLOURED_WGSL: 'abdadbb2c8a90aa5',
  SURFACE_CACHE_SHADOW_ARGS_WGSL: 'e748644cfeec6aa4',
  SURFACE_CACHE_SHADOW_TRACE_WGSL: 'b7898336cd27a184',
  SURFACE_CACHE_SHADOW_TRACE_COLOURED_WGSL: '77f4cb431af363ca',
  SURFACE_CACHE_STOCHASTIC_GENERATE_WGSL: 'c06886ad37b03057',
  SURFACE_CACHE_STOCHASTIC_COMPACT_WGSL: '63623ec4c29fa2bf',
  SURFACE_CACHE_STOCHASTIC_COMPACT_COLOURED_WGSL: 'b94d4f827513a8f9',
  SURFACE_CACHE_STOCHASTIC_SHADE_WGSL: '20a00ff1366b5643',
  SURFACE_CACHE_STOCHASTIC_SHADE_COLOURED_WGSL: 'd9ab808588189017',
  SURFACE_CACHE_STOCHASTIC_TEMPORAL_WGSL: 'a56b3f99563278ab',
  SURFACE_CACHE_RADIOSITY_BUILD_WGSL: '3cd762d737dc1f1d',
  SURFACE_CACHE_RADIOSITY_TRACE_WGSL: '4349cb1102459000',
  SURFACE_CACHE_RADIOSITY_TRACED_WGSL: '4c8e6d4eb2ab75dc',
  SURFACE_CACHE_RADIOSITY_FILTER_WGSL: '3ea2afcd4daba370',
  SURFACE_CACHE_RADIOSITY_INTEGRATE_WGSL: 'c8b9737509d51495',
  SURFACE_CACHE_TILE_DEPTH_RANGE: '4c5ec16d5eb973a9',
  SURFACE_CACHE_CULL: 'f05634a7b9fa93b9',
  SURFACE_CACHE_LIGHT_TILE_COUNTS: '0637a1d86f091a1b',
  SURFACE_CACHE_LIGHT_TILE_COMPACT: '3f284a690974065a',
  SURFACE_CACHE_COMBINE: 'ea6e1e372eb3d0e2',
  SURFACE_CACHE_COMBINE_COMPRESSED: 'a201efe327f6d6c7',
  TRANSLUCENCY_GI_TRACE: '8b8d79df7340a54c',
  TRANSLUCENCY_GI_TRACE_PACKED: '57e0744f578a9f81',
  REFLECTION_TRACE_HARDWARE_SHADER: '51696e76c65d17c8',
  REFLECTION_TRACE_NATIVE_SHADER: 'd594d96dd8cf3745',
  REFLECTION_TRACE_NATIVE_STATISTICS_SHADER: 'b3502242e1ee2b37',
  REFLECTION_TRACE_POLYFILL_SHADER: '264f8dd8964ec539',
  REFLECTION_TRACE_POLYFILL_STATISTICS_SHADER: '87a05e64c869a485',
  CACHE_TRACED_PROGRAM: 'd70d124ee0fb524f',
  CACHE_TRACE_PROGRAM: 'b68a665b44fe966b',
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
    layoutsShadow: 'ef257a0b5bbe8268',
    layoutsRadiosityTraced: '04e144a3739a50ce',
    layoutsShaped: 'b6ac6fd920be7f38',
    layoutsStochastic: '1896c80f0db5a6a6',
    layoutsCapture: '6f12f59be6e73943',
    atlasesfalse: '258f71d26e8c25c8',
    atlasestrue: 'f402ebe2d203e0d1',
  })
})
