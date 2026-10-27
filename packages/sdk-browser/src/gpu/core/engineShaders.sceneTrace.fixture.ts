// The scene trace's WGSL text of `ENGINE_SHADERS`: the library with the cut's tables it lists, as
// the probe that casts one ray through it compiles (`sceneTraceProbe.fixture.ts`), and the programs
// that cast through the scene's triangles: the reflections' scene stage (`reflectionHardwareKernels`)
// and the radiance cache's traced rays, and the pass that culls the placements for the image.
import { CACHE_TRACED_PROGRAM } from '../../lighting/bounce/cache/cacheTraceWgsl.ts'
import { reflectionTraceShader } from '../../lighting/reflections/trace/trace.ts'
import { SCENE_CULL_WGSL } from '../../lighting/rays/sceneTrace/sceneCullWgsl.ts'
import { SCENE_TRACE_PROBE } from '../../lighting/rays/sceneTrace/sceneTraceProbe.fixture.ts'

export const SCENE_TRACE_SHADERS: Record<string, string> = {
  SCENE_TRACE_PROBE,
  REFLECTION_TRACE_HARDWARE_SHADER: reflectionTraceShader(false, true),
  CACHE_TRACED_PROGRAM,
  SCENE_CULL_WGSL,
}
