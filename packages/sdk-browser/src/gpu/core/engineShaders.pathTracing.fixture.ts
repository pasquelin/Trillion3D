// The path tracer's WGSL texts of `ENGINE_SHADERS`: the trace of a bounce's rays and the finish of a bounce (each also where the clouds are traced), the clouds' acceleration map, the shade of the hits (of the surfaces that read their maps), the accumulation, the light grid, the sky's table,
// the error chain, the normals in the camera's space, the display and the denoiser's kernels.
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { PT_AIR_DEPTH_WGSL } from '../../lighting/pathTracing/airDepthWgsl.ts'
import { PT_CLOUD_MAP_WGSL } from '../../lighting/pathTracing/cloudMapWgsl.ts'
import { PT_ARGS_WGSL } from '../../lighting/pathTracing/argsProgram.ts'
import { PT_ACCUMULATE_WGSL } from '../../lighting/pathTracing/accumulateProgram.ts'
import { PT_ADAPTIVE_ERROR_KERNEL_WGSL } from '../../lighting/pathTracing/adaptiveErrorWgsl.ts'
import { PT_GRID_BUILD_WGSL, PT_SKY_BUILD_WGSL } from '../../lighting/pathTracing/buildPrograms.ts'
import { PT_DISPLAY_WGSL } from '../../lighting/pathTracing/displayWgsl.ts'
import { DN_MOTION_PROGRAMS } from '../../lighting/pathTracing/denoiseMotionWgsl.ts'
import { DN_PREPASS_PROGRAMS } from '../../lighting/pathTracing/denoisePrepassWgsl.ts'
import { DN_RESOLVE_PROGRAMS } from '../../lighting/pathTracing/denoiseResolveWgsl.ts'
import { DN_SPATIAL_WGSL } from '../../lighting/pathTracing/denoiseSpatialWgsl.ts'
import { DN_VISUALIZE_PROGRAMS } from '../../lighting/pathTracing/denoiseVisualizeWgsl.ts'
import { PT_NORMAL_SPACE_WGSL } from '../../lighting/pathTracing/normalSpaceWgsl.ts'
import { shadeHitProgram } from '../../lighting/pathTracing/shadeHitWgsl.ts'
import { ptFinishProgram, ptTraceProgram } from '../../lighting/pathTracing/traceProgram.ts'

export const PATH_TRACING_SHADERS: Record<string, string> = {
  PT_TRACE: ptTraceProgram(),
  PT_FINISH: ptFinishProgram(),
  PT_TRACE_CLOUDS: ptTraceProgram(undefined, true),
  PT_FINISH_CLOUDS: ptFinishProgram(undefined, true),
  PT_CLOUD_MAP: PT_CLOUD_MAP_WGSL,
  PT_SHADE_HITS: shadeHitProgram(),
  PT_ARGS: PT_ARGS_WGSL,
  PT_AIR_DEPTH: PT_AIR_DEPTH_WGSL,
  PT_ACCUMULATE: PT_ACCUMULATE_WGSL,
  PT_GRID_BUILD: PT_GRID_BUILD_WGSL,
  PT_SKY_BUILD: PT_SKY_BUILD_WGSL,
  PT_ERROR_CHAIN: wgslModule(PT_ADAPTIVE_ERROR_KERNEL_WGSL),
  PT_NORMAL_SPACE: wgslModule(PT_NORMAL_SPACE_WGSL),
  PT_DISPLAY: wgslModule(PT_DISPLAY_WGSL),
  PT_DENOISE_MIP: DN_MOTION_PROGRAMS.mip,
  PT_DENOISE_ALIGN: DN_MOTION_PROGRAMS.align,
  PT_DENOISE_BLUR: DN_MOTION_PROGRAMS.blur,
  PT_DENOISE_MERGE: DN_MOTION_PROGRAMS.merge,
  PT_DENOISE_SUBTRACT: DN_MOTION_PROGRAMS.subtract,
  PT_DENOISE_REJECT: DN_RESOLVE_PROGRAMS.reject,
  PT_DENOISE_RESOLVE: DN_RESOLVE_PROGRAMS.resolve,
  PT_DENOISE_FUSION: DN_RESOLVE_PROGRAMS.fusion,
  PT_DENOISE_PREPASS: DN_PREPASS_PROGRAMS.prepass,
  PT_DENOISE_VARIANCE: DN_PREPASS_PROGRAMS.texture,
  PT_DENOISE_SPATIAL: DN_SPATIAL_WGSL,
  PT_DENOISE_MOTION_VIEW: DN_VISUALIZE_PROGRAMS.motion,
  PT_DENOISE_WARP_VIEW: DN_VISUALIZE_PROGRAMS.warp,
}
