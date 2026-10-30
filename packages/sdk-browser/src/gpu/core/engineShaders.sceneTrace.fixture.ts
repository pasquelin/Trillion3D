// The scene trace's WGSL text of `ENGINE_SHADERS`: the library with the cut's tables it lists, as
// the probe that casts one ray through it compiles (`sceneTraceProbe.fixture.ts`), and the programs
// that cast through the scene's triangles: the reflections' scene stage (`reflectionHardwareKernels`)
// and the radiance cache's traced rays, and the pass that culls the placements for the image.
import { cacheTracedProgramOf } from '../../lighting/bounce/cache/cacheTraceWgsl.ts'
import { reflectionTraceShader } from '../../lighting/reflections/trace/trace.ts'
import {
  MESH_GRID_COMPACT_WGSL,
  MESH_GRID_CULL_WGSL,
  MESH_GRID_SCATTER_WGSL,
  MESH_GRID_START_OFFSETS_WGSL,
} from '../../lighting/rays/meshTrace/cullWgsl.ts'
import {
  RTT_RESOLVE_ENTRY,
  RTT_SPATIAL_ENTRY,
  RTT_TEMPORAL_ENTRY,
  tracedTranslucencyDenoiseProgram,
} from '../../lighting/reflections/translucency/denoiseWgsl.ts'
import { tracedTranslucencyProgram } from '../../lighting/reflections/translucency/traceWgsl.ts'
import { SCENE_CULL_WGSL } from '../../lighting/rays/sceneTrace/sceneCullWgsl.ts'
import { SCENE_TRACE_PROBE } from '../../lighting/rays/sceneTrace/sceneTraceProbe.fixture.ts'
import { WORD_LIGHT_FORMAT } from './lightAtlasFormat.ts'

const CACHE_TRACED_PROGRAM = cacheTracedProgramOf(WORD_LIGHT_FORMAT)

export const SCENE_TRACE_SHADERS: Record<string, string> = {
  SCENE_TRACE_PROBE,
  REFLECTION_TRACE_HARDWARE_SHADER: reflectionTraceShader(false, true),
  // The scene stage's march with the field's coarse mip read through the hardware's filter (`float32-filterable`).
  REFLECTION_TRACE_FILTERED_MIP_SHADER: reflectionTraceShader(
    false,
    false,
    'none',
    WORD_LIGHT_FORMAT,
    undefined,
    undefined,
    undefined,
    true,
  ),
  // The screen stage's two ways of counting the lanes of a subgroup still marching (`screenMarchLanes.ts`), as the device picks them.
  REFLECTION_TRACE_NATIVE_SHADER: reflectionTraceShader(false, false, 'native'),
  REFLECTION_TRACE_NATIVE_STATISTICS_SHADER: reflectionTraceShader(true, false, 'native'),
  REFLECTION_TRACE_POLYFILL_SHADER: reflectionTraceShader(false, false, 'polyfill'),
  REFLECTION_TRACE_POLYFILL_STATISTICS_SHADER: reflectionTraceShader(true, false, 'polyfill'),
  CACHE_TRACED_PROGRAM,
  // The traced translucency's trace, over the scene's triangles, and its denoising (`lighting/reflections/translucency/`).
  TRACED_TRANSLUCENCY_PROGRAM: tracedTranslucencyProgram(WORD_LIGHT_FORMAT),
  TRACED_TRANSLUCENCY_RESOLVE_PROGRAM: tracedTranslucencyDenoiseProgram(RTT_RESOLVE_ENTRY),
  TRACED_TRANSLUCENCY_TEMPORAL_PROGRAM: tracedTranslucencyDenoiseProgram(RTT_TEMPORAL_ENTRY),
  TRACED_TRANSLUCENCY_SPATIAL_PROGRAM: tracedTranslucencyDenoiseProgram(RTT_SPATIAL_ENTRY),
  SCENE_CULL_WGSL,
  // The mesh distance fields' grid of the trace (`lighting/rays/meshTrace/`): the culling, the scatter, the start offsets and the compaction.
  MESH_GRID_CULL_WGSL,
  MESH_GRID_SCATTER_WGSL,
  MESH_GRID_START_OFFSETS_WGSL,
  MESH_GRID_COMPACT_WGSL,
}
