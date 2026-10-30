// The ray-traced sky light's texts the engine compiles (`lighting/skyLightTraced/`), read by the shaders' Node tests.
import {
  skyCompositeProgram,
  skyRaysProgram,
  skyTraceProgram,
} from '../../lighting/skyLightTraced/skyLightTracedWgsl.ts'

/** The pass that draws the rays' directions, the trace (and the one that also marches the strands' voxels) and the composite. */
export const SKY_LIGHT_TRACED_SHADERS: Record<string, string> = {
  SKY_LIGHT_RAYS: skyRaysProgram(),
  SKY_LIGHT_TRACE: skyTraceProgram(),
  SKY_LIGHT_TRACE_HAIR_VOXELS: skyTraceProgram(undefined, true),
  SKY_LIGHT_COMPOSITE: skyCompositeProgram(),
}
