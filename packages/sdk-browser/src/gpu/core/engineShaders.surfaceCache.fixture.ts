// The surface cache's WGSL texts of `ENGINE_SHADERS`: the capture's kernels (the resolve, the resampling
// of the texels and of the light, the copy and the encoders of a compressed atlas), the lights' kernels of its update (the context, the
// direct light, the traced shadows' masks and trace, the radiosity passes, the cull, the combine), the atlas view and the feedback's
// compaction; and the translucency's composition and holdout, the programs that read its lighting volume, the
// volume's own passes and its global illumination's.
import { blendShader } from '../../blend/shader.ts'
import { WORD_LIGHT_FORMAT } from './lightAtlasFormat.ts'
import { FILTER_PROGRAM } from '../../lighting/translucency/filterWgsl.ts'
import { INJECT_PROGRAM } from '../../lighting/translucency/injectWgsl.ts'
import {
  ARGS_PROGRAM,
  CLEAR_PROGRAM,
  DILATE_PROGRAM,
  GATHER_PROGRAM,
} from '../../lighting/translucency/markWgsl.ts'
import { MARK_GI_PROGRAM } from '../../lighting/translucencyGi/markWgsl.ts'
import { traceGiProgram } from '../../lighting/translucencyGi/traceWgsl.ts'
import { filterGiProgram } from '../../lighting/translucencyGi/filterWgsl.ts'
import { integrateGiProgram } from '../../lighting/translucencyGi/integrateWgsl.ts'
import { COMPOSE_DUAL_WGSL, COMPOSE_WGSL, LATE_WGSL } from '../../blend/translucencyComposeWgsl.ts'
import { HOLDOUT_APPLY_WGSL, HOLDOUT_START_WGSL } from '../../blend/holdoutWgsl.ts'
import { CLEAR_BLOCKS_WGSL, ENCODE_WGSL } from '../../lighting/surfaceCache/compressWgsl.ts'
import {
  COPY_COMPRESSED_WGSL,
  COPY_WGSL,
  lightsProgramOf,
  resampleProgramOf,
  resampleLightingProgramOf,
  RESOLVE_WGSL,
} from '../../lighting/surfaceCache/copyWgsl.ts'
import { ATLAS_VIEW_WGSL } from '../../lighting/surfaceCache/debugWgsl.ts'
import { FEEDBACK_COMPACTION_SHADER } from '../../lighting/surfaceCache/feedbackWgsl.ts'
import { combineWgsl } from '../../lighting/surfaceCache/lighting/combineWgsl.ts'
import { CONTEXT_WGSL, SPLICE_WGSL } from '../../lighting/surfaceCache/lighting/contextWgsl.ts'
import { cullWgsl } from '../../lighting/surfaceCache/lighting/cullWgsl.ts'
import {
  LIGHT_TILE_COMPACT_WGSL,
  LIGHT_TILE_COUNTS_WGSL,
} from '../../lighting/surfaceCache/lighting/lightTilesWgsl.ts'
import { TILE_DEPTH_RANGE_WGSL } from '../../lighting/surfaceCache/lighting/tileDepthRangeWgsl.ts'
import { directProgramOf } from '../../lighting/surfaceCache/lighting/directWgsl.ts'
import { lightFunctionPassWgsl } from '../../lighting/surfaceCache/lighting/lightFunctionPassWgsl.ts'
import { RADIOSITY_BUILD_WGSL } from '../../lighting/surfaceCache/lighting/radiosityBuildWgsl.ts'
import { radiosityFilterProgramOf } from '../../lighting/surfaceCache/lighting/radiosityFilterWgsl.ts'
import { radiosityIntegrateProgramOf } from '../../lighting/surfaceCache/lighting/radiosityIntegrateWgsl.ts'
import {
  radiosityTraceProgramOf,
  radiosityTracedProgramOf,
} from '../../lighting/surfaceCache/lighting/radiosityTraceWgsl.ts'
import { shadowMaskProgramOf } from '../../lighting/surfaceCache/lighting/shadowMaskWgsl.ts'
import {
  STOCHASTIC_GENERATE_WGSL,
  stochasticTemporalProgramOf,
  stochasticCompactProgramOf,
  stochasticShadeProgramOf,
} from '../../lighting/surfaceCache/lighting/stochasticWgsl.ts'
import {
  SHADOW_ARGS_WGSL,
  SHADOW_TRACE_COLOURED_WGSL,
  SHADOW_TRACE_WGSL,
} from '../../lighting/surfaceCache/lighting/shadowTraceWgsl.ts'
const RESAMPLE_WGSL = resampleProgramOf(false, WORD_LIGHT_FORMAT)
const RESAMPLE_COMPRESSED_WGSL = resampleProgramOf(true, WORD_LIGHT_FORMAT)
const RESAMPLE_LIGHTING_WGSL = resampleLightingProgramOf(false, WORD_LIGHT_FORMAT)
const RESAMPLE_LIGHTING_COMPRESSED_WGSL = resampleLightingProgramOf(true, WORD_LIGHT_FORMAT)
const LIGHTS_WGSL = lightsProgramOf(WORD_LIGHT_FORMAT)
const RADIOSITY_FILTER_WGSL = radiosityFilterProgramOf(WORD_LIGHT_FORMAT)
const RADIOSITY_INTEGRATE_WGSL = radiosityIntegrateProgramOf(WORD_LIGHT_FORMAT)
const RADIOSITY_TRACE_WGSL = radiosityTraceProgramOf(WORD_LIGHT_FORMAT)
const RADIOSITY_TRACED_WGSL = radiosityTracedProgramOf(WORD_LIGHT_FORMAT)
const STOCHASTIC_TEMPORAL_WGSL = stochasticTemporalProgramOf(WORD_LIGHT_FORMAT)

/** The tile lights each tile of the cull keeps: any count, the text differs by one constant. */
const CULL_LIGHTS = 16

export const SURFACE_CACHE_SHADERS: Record<string, string> = {
  TRANSLUCENCY_MARK_CLEAR: CLEAR_PROGRAM,
  TRANSLUCENCY_MARK_DILATE: DILATE_PROGRAM,
  TRANSLUCENCY_MARK_GATHER: GATHER_PROGRAM,
  TRANSLUCENCY_MARK_ARGS: ARGS_PROGRAM,
  TRANSLUCENCY_COMPOSE_WGSL: COMPOSE_WGSL,
  TRANSLUCENCY_COMPOSE_DUAL_WGSL: COMPOSE_DUAL_WGSL,
  TRANSLUCENCY_LATE_WGSL: LATE_WGSL,
  HOLDOUT_START_WGSL,
  HOLDOUT_APPLY_WGSL,
  SURFACE_CACHE_RESOLVE_WGSL: RESOLVE_WGSL,
  SURFACE_CACHE_RESAMPLE_WGSL: RESAMPLE_WGSL,
  SURFACE_CACHE_RESAMPLE_COMPRESSED_WGSL: RESAMPLE_COMPRESSED_WGSL,
  SURFACE_CACHE_RESAMPLE_LIGHTING_WGSL: RESAMPLE_LIGHTING_WGSL,
  SURFACE_CACHE_RESAMPLE_LIGHTING_COMPRESSED_WGSL: RESAMPLE_LIGHTING_COMPRESSED_WGSL,
  SURFACE_CACHE_COPY_WGSL: COPY_WGSL,
  SURFACE_CACHE_COPY_COMPRESSED_WGSL: COPY_COMPRESSED_WGSL,
  SURFACE_CACHE_LIGHTS_WGSL: LIGHTS_WGSL,
  SURFACE_CACHE_ENCODE_WGSL: ENCODE_WGSL,
  SURFACE_CACHE_CLEAR_BLOCKS_WGSL: CLEAR_BLOCKS_WGSL,
  SURFACE_CACHE_ATLAS_VIEW_WGSL: ATLAS_VIEW_WGSL,
  SURFACE_CACHE_FEEDBACK_COMPACTION_SHADER: FEEDBACK_COMPACTION_SHADER,
  SURFACE_CACHE_CONTEXT_WGSL: CONTEXT_WGSL,
  SURFACE_CACHE_SPLICE_WGSL: SPLICE_WGSL,
  SURFACE_CACHE_DIRECT_WGSL: directProgramOf('grey', WORD_LIGHT_FORMAT),
  SURFACE_CACHE_DIRECT_COLOURED_WGSL: directProgramOf('colour', WORD_LIGHT_FORMAT),
  SURFACE_CACHE_LIGHT_FUNCTION_PASS_WGSL: lightFunctionPassWgsl({ mapped: false }),
  SURFACE_CACHE_LIGHT_FUNCTION_PASS_MAPPED_WGSL: lightFunctionPassWgsl({ mapped: true }),
  SURFACE_CACHE_SHADOW_MASK_WGSL: shadowMaskProgramOf('grey'),
  SURFACE_CACHE_SHADOW_MASK_COLOURED_WGSL: shadowMaskProgramOf('colour'),
  SURFACE_CACHE_SHADOW_ARGS_WGSL: SHADOW_ARGS_WGSL,
  SURFACE_CACHE_SHADOW_TRACE_WGSL: SHADOW_TRACE_WGSL,
  SURFACE_CACHE_SHADOW_TRACE_COLOURED_WGSL: SHADOW_TRACE_COLOURED_WGSL,
  SURFACE_CACHE_STOCHASTIC_GENERATE_WGSL: STOCHASTIC_GENERATE_WGSL,
  SURFACE_CACHE_STOCHASTIC_COMPACT_WGSL: stochasticCompactProgramOf('grey'),
  SURFACE_CACHE_STOCHASTIC_COMPACT_COLOURED_WGSL: stochasticCompactProgramOf('colour'),
  SURFACE_CACHE_STOCHASTIC_SHADE_WGSL: stochasticShadeProgramOf('grey', WORD_LIGHT_FORMAT),
  SURFACE_CACHE_STOCHASTIC_SHADE_COLOURED_WGSL: stochasticShadeProgramOf(
    'colour',
    WORD_LIGHT_FORMAT,
  ),
  SURFACE_CACHE_STOCHASTIC_TEMPORAL_WGSL: STOCHASTIC_TEMPORAL_WGSL,
  SURFACE_CACHE_RADIOSITY_BUILD_WGSL: RADIOSITY_BUILD_WGSL,
  SURFACE_CACHE_RADIOSITY_TRACE_WGSL: RADIOSITY_TRACE_WGSL,
  SURFACE_CACHE_RADIOSITY_TRACED_WGSL: RADIOSITY_TRACED_WGSL,
  SURFACE_CACHE_RADIOSITY_FILTER_WGSL: RADIOSITY_FILTER_WGSL,
  SURFACE_CACHE_RADIOSITY_INTEGRATE_WGSL: RADIOSITY_INTEGRATE_WGSL,
  SURFACE_CACHE_TILE_DEPTH_RANGE: TILE_DEPTH_RANGE_WGSL,
  SURFACE_CACHE_CULL: cullWgsl(CULL_LIGHTS),
  SURFACE_CACHE_LIGHT_TILE_COUNTS: LIGHT_TILE_COUNTS_WGSL,
  SURFACE_CACHE_LIGHT_TILE_COMPACT: LIGHT_TILE_COMPACT_WGSL,
  SURFACE_CACHE_COMBINE: combineWgsl(false, WORD_LIGHT_FORMAT),
  SURFACE_CACHE_COMBINE_COMPRESSED: combineWgsl(true, WORD_LIGHT_FORMAT),
  // The programs that read the translucency lighting volume (a scene with a surface whose material
  // sets `translucencyLighting`), and the volume's own passes (`../../lighting/translucency/`).
  BLEND_TRANSLUCENCY_VOLUME: blendShader({}, { translucencyVolume: true }),
  BLEND_TRANSLUCENCY_VOLUME_LOBELESS: blendShader({ lobeless: true }, { translucencyVolume: true }),
  TRANSLUCENCY_INJECT: INJECT_PROGRAM,
  TRANSLUCENCY_FILTER: FILTER_PROGRAM,
  // The translucency global illumination volume's passes (`../../lighting/translucencyGi/`).
  TRANSLUCENCY_GI_MARK: MARK_GI_PROGRAM,
  TRANSLUCENCY_GI_TRACE: traceGiProgram('rgba16float'),
  TRANSLUCENCY_GI_TRACE_PACKED: traceGiProgram('rg11b10ufloat'),
  TRANSLUCENCY_GI_FILTER: filterGiProgram('rgba16float'),
  TRANSLUCENCY_GI_FILTER_PACKED: filterGiProgram('rg11b10ufloat'),
  TRANSLUCENCY_GI_INTEGRATE: integrateGiProgram('rgba16float', 'rgba16float'),
  TRANSLUCENCY_GI_INTEGRATE_PACKED: integrateGiProgram('rg11b10ufloat', 'rgba16float'),
}
