// The temporal anti-aliasing passes' WGSL texts of `ENGINE_SHADERS`: the resolve in each form, the velocity (and the
// one that flattens the motion blur's motion too), the
// reprojection, the thin geometry, the flicker measure (in 16 bits and as a wave too), the shading rejection, the history's resolve and the spatial
// anti-aliasing: the update too with the packed formats, with the half-size image and as each wave
// variant runs it, the update, the shading rejection and the anti-aliasing in 16 bits, and the rejection and the anti-aliasing
// with the mask and the LDR luma as textures.
import { taaResolveShader } from '../../post/taa/resolveWgsl.ts'
import { HALF_PRECISION } from '../../post/taa/colorSpaceWgsl.ts'
import { spatialAntiAliasingShader } from '../../post/taa/spatialAntiAliasingWgsl.ts'
import { velocityShader } from '../../post/taa/nearestVelocityWgsl.ts'
import { SURFACE_VELOCITY_WGSL } from '../../post/taa/surfaceVelocityWgsl.ts'
import { reprojectShader } from '../../post/taa/reprojectWgsl.ts'
import { thinGeometryShader, thinRelaxationShader } from '../../post/taa/thinGeometryWgsl.ts'
import {
  measureFlickerLumaShader,
  measureThinCoverageShader,
} from '../../post/taa/flickerLumaWgsl.ts'
import { flickerMeasureShader } from '../../post/taa/flickerMeasureWgsl.ts'
import { rejectShadingShader } from '../../post/taa/rejectionWgsl.ts'
import { resolveHistoryShader, resolveLayersShader } from '../../post/taa/historyResolveWgsl.ts'
import { TAA_SHADER } from './shaderTexts.fixture.ts'

export const TAA_SHADERS: Record<string, string> = {
  TAA_SHADER,
  TAA_RESOLVE_FILTERED: taaResolveShader(true),
  TAA_RESOLVE_PACKED: taaResolveShader(false, 'rg11b10ufloat', { validity: 'r8unorm' }),
  TAA_RESOLVE_HALF: taaResolveShader(false, 'rgba16float', { half: true }),
  TAA_RESOLVE_HALF_FILTERED: taaResolveShader(true, 'rgba16float', { half: true }),
  TAA_RESOLVE_WAVE: taaResolveShader(false, 'rgba16float', {
    half: true,
    wave: { lanes: 32, pinned: false },
  }),
  TAA_RESOLVE_WAVE_PINNED: taaResolveShader(true, 'rgba16float', {
    half: true,
    wave: { lanes: 16, pinned: true },
  }),
  TAA_RESOLVE_F16: taaResolveShader(false, 'rgba16float', {
    precision: HALF_PRECISION,
  }),
  TAA_RESOLVE_F16_PACKED: taaResolveShader(false, 'rg11b10ufloat', {
    validity: 'r8unorm',
    precision: HALF_PRECISION,
  }),
  TAA_RESOLVE_F16_FILTERED: taaResolveShader(true, 'rgba16float', {
    precision: HALF_PRECISION,
  }),
  TAA_RESOLVE_F16_HALF: taaResolveShader(false, 'rgba16float', {
    half: true,
    precision: HALF_PRECISION,
  }),
  TAA_RESOLVE_F16_WAVE: taaResolveShader(true, 'rgba16float', {
    half: true,
    wave: { lanes: 32, pinned: false },
    precision: HALF_PRECISION,
  }),
  TAA_VELOCITY: velocityShader(),
  TAA_VELOCITY_FUSED: velocityShader(undefined, { directions: 1, flat: 'packed' }),
  TAA_VELOCITY_FUSED_TWO: velocityShader(undefined, { directions: 2, flat: 'float' }),
  SURFACE_VELOCITY_WGSL,
  TAA_REPROJECT: reprojectShader('rgba8unorm'),
  TAA_REPROJECT_PACKED: reprojectShader('rgb10a2unorm'),
  TAA_THIN_GEOMETRY: thinGeometryShader(),
  TAA_THIN_RELAXATION: thinRelaxationShader('rgba8unorm'),
  TAA_THIN_RELAXATION_PACKED: thinRelaxationShader('r8unorm'),
  TAA_MEASURE_LUMA: measureFlickerLumaShader('rgba8unorm'),
  TAA_MEASURE_LUMA_PACKED: measureFlickerLumaShader('r8unorm'),
  TAA_MEASURE_COVERAGE: measureThinCoverageShader('rgba8unorm'),
  TAA_MEASURE_COVERAGE_PACKED: measureThinCoverageShader('r8unorm'),
  TAA_REJECT_SHADING: rejectShadingShader('rgba8unorm', 'rgba16float'),
  TAA_REJECT_SHADING_PACKED: rejectShadingShader('rgb10a2unorm', 'rg11b10ufloat'),
  TAA_REJECT_SHADING_TEXTURES: rejectShadingShader(
    'rgb10a2unorm',
    'rg11b10ufloat',
    false,
    'texture',
    'texture',
  ),
  TAA_REJECT_SHADING_F16_TEXTURES: rejectShadingShader(
    'rgb10a2unorm',
    'rg11b10ufloat',
    true,
    'texture',
    'texture',
  ),
  TAA_FLICKER_MEASURE: flickerMeasureShader(),
  TAA_FLICKER_MEASURE_F16: flickerMeasureShader(true),
  TAA_FLICKER_MEASURE_WAVE: flickerMeasureShader(false, { lanes: 32, pinned: false }),
  TAA_RESOLVE_HISTORY: resolveHistoryShader('rgba16float'),
  TAA_RESOLVE_HISTORY_PACKED: resolveHistoryShader('rg11b10ufloat'),
  TAA_RESOLVE_LAYERS: resolveLayersShader(),
  TAA_SPATIAL_AA: spatialAntiAliasingShader(),
  TAA_SPATIAL_AA_PACKED: spatialAntiAliasingShader('rg8uint'),
  TAA_SPATIAL_AA_TEXTURES: spatialAntiAliasingShader('rg8uint', false, 'texture', 'texture'),
  TAA_SPATIAL_AA_F16: spatialAntiAliasingShader('rgba8uint', true),
}
