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
  REFLECTION_TRACE_SHADER: 'e5c1d66e79e10750',
  REFLECTION_TRACE_STATISTICS_SHADER: '0946288bf6e05806',
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
  SURFACE_CACHE_CONTEXT_WGSL: '91492f7a0e6c80d0',
  SURFACE_CACHE_SPLICE_WGSL: '549656dc6633a005',
  SURFACE_CACHE_DIRECT_WGSL: '81b1e827e3fa58fd',
  SURFACE_CACHE_DIRECT_COLOURED_WGSL: '95486a77a4e04646',
  SURFACE_CACHE_LIGHT_FUNCTION_PASS_WGSL: '61911a36673a672e',
  SURFACE_CACHE_LIGHT_FUNCTION_PASS_MAPPED_WGSL: '79e0a605029b4a6e',
  SURFACE_CACHE_SHADOW_MASK_WGSL: 'a43c02df8ef26abf',
  SURFACE_CACHE_SHADOW_MASK_COLOURED_WGSL: 'e35ce8962998e81f',
  SURFACE_CACHE_SHADOW_ARGS_WGSL: '3dbd28f785774d74',
  SURFACE_CACHE_SHADOW_TRACE_WGSL: 'cf4a4b98b5cdee96',
  SURFACE_CACHE_SHADOW_TRACE_COLOURED_WGSL: '30c2f93f7810e9cf',
  SURFACE_CACHE_STOCHASTIC_GENERATE_WGSL: 'be219a0876a613f8',
  SURFACE_CACHE_STOCHASTIC_COMPACT_WGSL: 'a6a88f27b626ec6b',
  SURFACE_CACHE_STOCHASTIC_COMPACT_COLOURED_WGSL: 'bc23086ba160962e',
  SURFACE_CACHE_STOCHASTIC_SHADE_WGSL: '6d532e7c444df543',
  SURFACE_CACHE_STOCHASTIC_SHADE_COLOURED_WGSL: '8d73cd60139a81a2',
  SURFACE_CACHE_STOCHASTIC_TEMPORAL_WGSL: 'fd85eb3054633b57',
  SURFACE_CACHE_RADIOSITY_BUILD_WGSL: 'f2cf9660e5540318',
  SURFACE_CACHE_RADIOSITY_TRACE_WGSL: '818663dec0b14070',
  SURFACE_CACHE_RADIOSITY_TRACED_WGSL: '81e8b7642bf1d99c',
  SURFACE_CACHE_RADIOSITY_FILTER_WGSL: '93b4cc8346bf0957',
  SURFACE_CACHE_RADIOSITY_INTEGRATE_WGSL: 'ef86d496cc6635fa',
  SURFACE_CACHE_TILE_DEPTH_RANGE: 'a8f8023b1a8021e8',
  SURFACE_CACHE_CULL: '0a1406a442f4e618',
  SURFACE_CACHE_LIGHT_TILE_COUNTS: 'ec31a617765b2ce2',
  SURFACE_CACHE_LIGHT_TILE_COMPACT: '0060ffdf70dce7eb',
  SURFACE_CACHE_COMBINE: '9b96f737ef9cbfa1',
  SURFACE_CACHE_COMBINE_COMPRESSED: '3fbe0f3da644b178',
  TRANSLUCENCY_GI_TRACE: 'faf92552285a274a',
  TRANSLUCENCY_GI_TRACE_PACKED: 'e66ee5d2883edc56',
  REFLECTION_TRACE_HARDWARE_SHADER: '3b573d74b4b78bf5',
  REFLECTION_TRACE_NATIVE_SHADER: '258a3a21754b3506',
  REFLECTION_TRACE_NATIVE_STATISTICS_SHADER: '03e175f9a5071b3a',
  REFLECTION_TRACE_POLYFILL_SHADER: 'eff580b35a9ed99d',
  REFLECTION_TRACE_POLYFILL_STATISTICS_SHADER: '9891eb4b30de802b',
  CACHE_TRACED_PROGRAM: 'e9c93485455def4f',
  CACHE_TRACE_PROGRAM: '89c2db3e939ef5ec',
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
  // traced radiance): the surface cache's own programs unchanged. Re-pinned after c9's deduplication sweeps of 29/10: the shared helpers
  // (table words, depth, segment-box span, vignette, held layers) declared once, the same operations; the direct mesh pass's layout lost the
  // view cascade's subsurface colour, which only its transmission read, never on for the cards.
  assert.deepEqual(recorded(), {
    layoutsFixedGrey: '7cf8802b2ca040bd',
    layoutsFixedColour: '7cf8802b2ca040bd',
    layoutsDirectMesh: 'e95c204336065ad3',
    layoutsShadow: '4c025fadbd4ba6df',
    layoutsRadiosityTraced: 'e86279f8aa04f1bd',
    layoutsShaped: 'b6ac6fd920be7f38',
    layoutsStochastic: 'f0a06a1633d1ef73',
    layoutsCapture: '6f12f59be6e73943',
    atlasesfalse: '258f71d26e8c25c8',
    atlasestrue: 'f402ebe2d203e0d1',
  })
})
