// The path tracer's WGSL texts of `ENGINE_SHADERS`: the trace of a bounce's rays, the finish of a bounce, the shade of the hits (of the surfaces that read their maps), the accumulation, the light grid, the sky's table,
// the error chain, the normals in the camera's space and the display.
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { PT_ARGS_WGSL } from '../../lighting/pathTracing/argsProgram.ts'
import { PT_ACCUMULATE_WGSL } from '../../lighting/pathTracing/accumulateProgram.ts'
import { PT_ADAPTIVE_ERROR_KERNEL_WGSL } from '../../lighting/pathTracing/adaptiveErrorWgsl.ts'
import { PT_GRID_BUILD_WGSL, PT_SKY_BUILD_WGSL } from '../../lighting/pathTracing/buildPrograms.ts'
import { PT_DISPLAY_WGSL } from '../../lighting/pathTracing/displayWgsl.ts'
import { PT_NORMAL_SPACE_WGSL } from '../../lighting/pathTracing/normalSpaceWgsl.ts'
import { shadeHitProgram } from '../../lighting/pathTracing/shadeHitWgsl.ts'
import { ptFinishProgram, ptTraceProgram } from '../../lighting/pathTracing/traceProgram.ts'

export const PATH_TRACING_SHADERS: Record<string, string> = {
  PT_TRACE: ptTraceProgram(),
  PT_FINISH: ptFinishProgram(),
  PT_SHADE_HITS: shadeHitProgram(),
  PT_ARGS: PT_ARGS_WGSL,
  PT_ACCUMULATE: PT_ACCUMULATE_WGSL,
  PT_GRID_BUILD: PT_GRID_BUILD_WGSL,
  PT_SKY_BUILD: PT_SKY_BUILD_WGSL,
  PT_ERROR_CHAIN: wgslModule(PT_ADAPTIVE_ERROR_KERNEL_WGSL),
  PT_NORMAL_SPACE: wgslModule(PT_NORMAL_SPACE_WGSL),
  PT_DISPLAY: wgslModule(PT_DISPLAY_WGSL),
}
