// The reflections' hit lighting texts the engine compiles (`lighting/reflections/hitLighting/`), read by the shaders' Node tests.
import { reflectionTraceShader } from '../../lighting/reflections/trace/trace.ts'
import { litCompactProgram } from '../../lighting/reflections/hitLighting/litWgsl.ts'
import { SORT_TRACES_WGSL } from '../../lighting/reflections/translucency/sortWgsl.ts'
import {
  probeLitCompactProgram,
  probeLitDirectProgram,
  probeLitFinishProgram,
} from '../../lighting/bounce/screen/hitLitWgsl.ts'
import {
  cacheLitCompactProgram,
  cacheLitDirectProgram,
  cacheLitFinishProgram,
} from '../../lighting/bounce/cache/cacheHitLitWgsl.ts'
import { cacheTracedProgramOf } from '../../lighting/bounce/cache/cacheTraceWgsl.ts'
import { lightGridBuildProgram } from '../../lighting/rays/lightGrid/lightGridWgsl.ts'
import { traceTracedShader } from '../../lighting/bounce/screen/traceTracedWgsl.ts'
import { WORD_LIGHT_FORMAT } from './lightAtlasFormat.ts'

/** The scene stage through the scene's triangles with no hit lighting, with its first pass, and the second pass's program; the compaction and the sort. */
export const HIT_LIGHTING_SHADERS: Record<string, string> = {
  REFLECTION_SCENE_TRACE_NO_HIT_LIGHTING: reflectionTraceShader(false, true),
  REFLECTION_SCENE_TRACE_HIT_LIGHTING_DIRECT: reflectionTraceShader(
    false,
    true,
    'none',
    WORD_LIGHT_FORMAT,
    undefined,
    undefined,
    'direct',
  ),
  REFLECTION_SCENE_TRACE_HIT_LIGHTING_FINISH: reflectionTraceShader(
    false,
    true,
    'none',
    WORD_LIGHT_FORMAT,
    undefined,
    undefined,
    'finish',
  ),
  REFLECTION_HIT_LIGHTING_COMPACT: litCompactProgram(),
  REFLECTION_HIT_LIGHTING_SORT: SORT_TRACES_WGSL,
  HIT_LIGHTING_LIGHT_GRID_BUILD: lightGridBuildProgram(),
  SCREEN_PROBE_TRACED_MARKS: traceTracedShader(8, [4, 4], true, WORD_LIGHT_FORMAT, undefined, true),
  SCREEN_PROBE_HIT_LIGHTING_COMPACT: probeLitCompactProgram(8, [4, 4]),
  SCREEN_PROBE_HIT_LIGHTING_DIRECT: probeLitDirectProgram(8, [4, 4]),
  SCREEN_PROBE_HIT_LIGHTING_FINISH: probeLitFinishProgram(8, [4, 4], false),
  SCREEN_PROBE_HIT_LIGHTING_FINISH_FOG: probeLitFinishProgram(8, [4, 4], true),
  RADIANCE_CACHE_TRACED_MARKS: cacheTracedProgramOf(WORD_LIGHT_FORMAT, undefined, true),
  RADIANCE_CACHE_HIT_LIGHTING_COMPACT: cacheLitCompactProgram(),
  RADIANCE_CACHE_HIT_LIGHTING_DIRECT: cacheLitDirectProgram(),
  RADIANCE_CACHE_HIT_LIGHTING_FINISH: cacheLitFinishProgram(WORD_LIGHT_FORMAT),
}
