// The scene trace's WGSL text of `ENGINE_SHADERS`: the library with the cut's tables it lists, as
// the probe that casts one ray through it compiles (`sceneTraceProbe.fixture.ts`).
import { SCENE_TRACE_PROBE } from '../../lighting/rays/sceneTrace/sceneTraceProbe.fixture.ts'

export const SCENE_TRACE_SHADERS: Record<string, string> = {
  SCENE_TRACE_PROBE,
}
