// The WGSL text of `ENGINE_SHADERS` that depends on the format an atlas of light is stored in (`lightAtlasFormat.ts`): the passes that write or read the radiance cache's final maps
// and the surface cache's direct, indirect and final light (and every pass whose rays read that final light at their hits), in each format but the word format, which the main
// list holds (`CACHE_FILTER_PROGRAM`, `CACHE_FIXUP_PROGRAM`, `FIELD_IRRADIANCE_MAPS`, `FIELD_GATHER`, `SURFACE_CACHE_*`).
import { cacheFilterProgram } from '../../lighting/bounce/cache/cacheFilterWgsl.ts'
import { cacheFixupProgram } from '../../lighting/bounce/cache/cacheFixupWgsl.ts'
import { fieldGatherProgram } from '../../lighting/bounce/irradianceField/gatherWgsl.ts'
import {
  irradianceProgram,
  occlusionProgram,
} from '../../lighting/bounce/irradianceField/mapsWgsl.ts'
import { raysShader } from '../../lighting/bounce/screen/importanceWgsl.ts'
import { traceMeshShader } from '../../lighting/bounce/screen/traceMeshWgsl.ts'
import { traceSceneShader } from '../../lighting/bounce/screen/traceSceneWgsl.ts'
import { traceGiProgram } from '../../lighting/translucencyGi/traceWgsl.ts'
import {
  cacheSplatProgramOf,
  cacheTraceProgramOf,
  cacheTracedProgramOf,
} from '../../lighting/bounce/cache/cacheTraceWgsl.ts'
import { traceTracedShader } from '../../lighting/bounce/screen/traceTracedWgsl.ts'
import { reflectionTraceShader } from '../../lighting/reflections/trace/trace.ts'
import { combineWgsl } from '../../lighting/surfaceCache/lighting/combineWgsl.ts'
import {
  directMeshProgramOf,
  meshSunPrepassProgram,
  directProgramOf,
} from '../../lighting/surfaceCache/lighting/directWgsl.ts'
import { radiosityFilterProgramOf } from '../../lighting/surfaceCache/lighting/radiosityFilterWgsl.ts'
import { radiosityIntegrateProgramOf } from '../../lighting/surfaceCache/lighting/radiosityIntegrateWgsl.ts'
import {
  radiosityTraceProgramOf,
  radiosityTracedProgramOf,
} from '../../lighting/surfaceCache/lighting/radiosityTraceWgsl.ts'
import {
  stochasticShadeProgramOf,
  stochasticTemporalProgramOf,
} from '../../lighting/surfaceCache/lighting/stochasticWgsl.ts'
import {
  lightsProgramOf,
  resampleLightingProgramOf,
  resampleProgramOf,
} from '../../lighting/surfaceCache/copyWgsl.ts'
import type { LightAtlasFormat } from './lightAtlasFormat.ts'
import { WORD_LIGHT_FORMAT } from './lightAtlasFormat.ts'

const FORMATS: readonly LightAtlasFormat[] = ['rg11b10ufloat', 'rgba16float', 'rgba32float']

export const LIGHT_FORMAT_SHADERS: Record<string, string> = Object.fromEntries(
  FORMATS.flatMap((format) => [
    [`CACHE_FILTER_${format}`, cacheFilterProgram(format)],
    [`CACHE_FIXUP_${format}`, cacheFixupProgram(format)],
    [`FIELD_IRRADIANCE_MAPS_${format}`, irradianceProgram(8, format)],
    [`FIELD_GATHER_${format}`, fieldGatherProgram(format)],
    [`SCREEN_PROBE_RAYS_${format}`, raysShader(8, 8, [4, 4], format)],
    [`SCREEN_PROBE_TRACE_SCENE_${format}`, traceSceneShader(8, [4, 4], false, [], format)],
    [`SCREEN_PROBE_TRACE_MESHES_${format}`, traceMeshShader(8, [4, 4], false, format)],
    [`TRANSLUCENCY_GI_TRACE_${format}`, traceGiProgram('rgba16float', format)],
    [`CACHE_TRACE_${format}`, cacheTraceProgramOf(format)],
    [`CACHE_SPLAT_${format}`, cacheSplatProgramOf(format)],
    [`FIELD_OCCLUSION_MAPS_${format}`, occlusionProgram(8, format)],
    [`CACHE_TRACED_${format}`, cacheTracedProgramOf(format)],
    [`SCREEN_PROBE_TRACE_TRIANGLES_${format}`, traceTracedShader(8, [4, 4], false, format)],
    [`REFLECTION_TRACE_${format}`, reflectionTraceShader(false, false, 'none', format)],
    [`REFLECTION_TRACE_HARDWARE_${format}`, reflectionTraceShader(false, true, 'none', format)],
    [`SURFACE_CACHE_RESAMPLE_${format}`, resampleProgramOf(false, format)],
    [`SURFACE_CACHE_RESAMPLE_LIGHTING_${format}`, resampleLightingProgramOf(false, format)],
    [
      `SURFACE_CACHE_RESAMPLE_LIGHTING_COMPRESSED_${format}`,
      resampleLightingProgramOf(true, format),
    ],
    [`SURFACE_CACHE_LIGHTS_${format}`, lightsProgramOf(format)],
    [`SURFACE_CACHE_DIRECT_${format}`, directProgramOf('grey', format)],
    [`SURFACE_CACHE_DIRECT_MESH_COLOURED_${format}`, directMeshProgramOf('colour', format)],
    ['SURFACE_CACHE_DIRECT_MESH_SUNS', meshSunPrepassProgram()],
    [`SURFACE_CACHE_STOCHASTIC_SHADE_${format}`, stochasticShadeProgramOf('grey', format)],
    [`SURFACE_CACHE_STOCHASTIC_TEMPORAL_${format}`, stochasticTemporalProgramOf(format)],
    [`SURFACE_CACHE_COMBINE_${format}`, combineWgsl(false, format)],
    [`SURFACE_CACHE_COMBINE_COMPRESSED_${format}`, combineWgsl(true, format)],
    [`SURFACE_CACHE_RADIOSITY_TRACE_${format}`, radiosityTraceProgramOf(format)],
    [`SURFACE_CACHE_RADIOSITY_TRACED_${format}`, radiosityTracedProgramOf(format)],
    [`SURFACE_CACHE_RADIOSITY_FILTER_${format}`, radiosityFilterProgramOf(format)],
    [`SURFACE_CACHE_RADIOSITY_INTEGRATE_${format}`, radiosityIntegrateProgramOf(format)],
  ]),
)
