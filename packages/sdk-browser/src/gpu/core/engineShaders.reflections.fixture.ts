import { contractLightingProgram } from '../../lighting/deferred/shaders.ts'
import {
  REFLECTION_BOUNDS_DEPTH_WGSL,
  REFLECTION_BOUNDS_LEVEL_WGSL,
} from '../../reflections/boundsPyramidWgsl.ts'
import { REFLECTION_RESOLVE_WGSL } from '../../reflections/resolveWgsl.ts'
import { stochasticReflectionShader } from '../../reflections/sampleWgsl.ts'
import { withScreenReflections } from '../../reflections/screenWgsl.ts'
import { withReflectionSourceOutput } from '../../reflections/sourceOutputWgsl.ts'
import { REFLECTION_SOURCE_WGSL } from '../../reflections/sourceWgsl.ts'

/** Every runtime reflection text by its module's name: each lighting lobe and binding width of the
 *  trace and the history composition, the resolve, the source and the depth bounds pyramid. */
export function reflectionShaders() {
  const shaders: Record<string, string> = {
    REFLECTION_RESOLVE_WGSL,
    REFLECTION_SOURCE_WGSL,
    REFLECTION_BOUNDS_DEPTH_WGSL,
    REFLECTION_BOUNDS_LEVEL_WGSL,
  }
  for (const bounce of [false, true])
    for (const narrow of [false, true]) {
      const shader = contractLightingProgram(bounce, { narrow, lobeless: true })
      const key = `REFLECTION_${bounce ? 'BOUNCE' : 'DIRECT'}_${narrow ? 'NARROW' : 'WIDE'}`
      shaders[`${key}_TRACE`] = stochasticReflectionShader(shader)
      shaders[`${key}_TRACE_REFERENCE`] = stochasticReflectionShader(shader, { unbounded: true })
      shaders[`${key}_HISTORY_COMPOSE`] = withReflectionSourceOutput(
        withScreenReflections(shader, { history: true }),
      )
    }
  return shaders
}
