// The surface cache's WGSL texts of `ENGINE_SHADERS`: the capture's kernels (the resolve, the resampling
// of the texels and of the light, the copy and the encoders of a compressed atlas), the lights' kernels of its update (the context, the
// direct light, the radiosity passes, the cull, the combine), the atlas view and the feedback's
// compaction; and the translucency's composition and holdout.
import { COMPOSE_DUAL_WGSL, COMPOSE_WGSL, LATE_WGSL } from '../../blend/translucencyComposeWgsl.ts'
import { HOLDOUT_APPLY_WGSL, HOLDOUT_START_WGSL } from '../../blend/holdoutWgsl.ts'
import { CLEAR_BLOCKS_WGSL, ENCODE_WGSL } from '../../lighting/surfaceCache/compressWgsl.ts'
import {
  COPY_COMPRESSED_WGSL,
  COPY_WGSL,
  LIGHTS_WGSL,
  RESAMPLE_COMPRESSED_WGSL,
  RESAMPLE_LIGHTING_COMPRESSED_WGSL,
  RESAMPLE_LIGHTING_WGSL,
  RESAMPLE_WGSL,
  RESOLVE_WGSL,
} from '../../lighting/surfaceCache/copyWgsl.ts'
import { ATLAS_VIEW_WGSL } from '../../lighting/surfaceCache/debugWgsl.ts'
import { FEEDBACK_COMPACTION_SHADER } from '../../lighting/surfaceCache/feedbackWgsl.ts'
import { combineWgsl } from '../../lighting/surfaceCache/lighting/combineWgsl.ts'
import { CONTEXT_WGSL } from '../../lighting/surfaceCache/lighting/contextWgsl.ts'
import { cullWgsl } from '../../lighting/surfaceCache/lighting/cullWgsl.ts'
import { DIRECT_WGSL } from '../../lighting/surfaceCache/lighting/directWgsl.ts'
import { RADIOSITY_BUILD_WGSL } from '../../lighting/surfaceCache/lighting/radiosityBuildWgsl.ts'
import { RADIOSITY_FILTER_WGSL } from '../../lighting/surfaceCache/lighting/radiosityFilterWgsl.ts'
import { RADIOSITY_INTEGRATE_WGSL } from '../../lighting/surfaceCache/lighting/radiosityIntegrateWgsl.ts'
import { RADIOSITY_TRACE_WGSL } from '../../lighting/surfaceCache/lighting/radiosityTraceWgsl.ts'

/** The tile lights each tile of the cull keeps: any count, the text differs by one constant. */
const CULL_LIGHTS = 16

export const SURFACE_CACHE_SHADERS: Record<string, string> = {
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
  SURFACE_CACHE_DIRECT_WGSL: DIRECT_WGSL,
  SURFACE_CACHE_RADIOSITY_BUILD_WGSL: RADIOSITY_BUILD_WGSL,
  SURFACE_CACHE_RADIOSITY_TRACE_WGSL: RADIOSITY_TRACE_WGSL,
  SURFACE_CACHE_RADIOSITY_FILTER_WGSL: RADIOSITY_FILTER_WGSL,
  SURFACE_CACHE_RADIOSITY_INTEGRATE_WGSL: RADIOSITY_INTEGRATE_WGSL,
  SURFACE_CACHE_CULL: cullWgsl(CULL_LIGHTS),
  SURFACE_CACHE_COMBINE: combineWgsl(false),
  SURFACE_CACHE_COMBINE_COMPRESSED: combineWgsl(true),
}
