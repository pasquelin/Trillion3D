// The screen-space traces' WGSL texts of `ENGINE_SHADERS`: the reflections at each level, their tile lists, the last image's reduction and the
// indirect light at each quality.
import { denoiseAccumulationWgsl } from '../../lighting/screenSpaceTracing/denoise/accumulationWgsl.ts'
import { keepWgsl } from '../../lighting/screenSpaceTracing/denoise/keepWgsl.ts'
import { denoiseSpatialWgsl } from '../../lighting/screenSpaceTracing/denoise/spatialWgsl.ts'
import { composeWgsl } from '../../lighting/screenSpaceTracing/composeWgsl.ts'
import { halfResWgsl } from '../../lighting/screenSpaceTracing/halfResWgsl.ts'
import { diffuseWgsl } from '../../lighting/screenSpaceTracing/diffuseWgsl.ts'
import {
  prevFrameFirstWgsl,
  prevFrameLowerWgsl,
} from '../../lighting/screenSpaceTracing/prevFrameWgsl.ts'
import { temporalWgsl } from '../../lighting/screenSpaceTracing/temporalWgsl.ts'
import {
  screenReflectionsWgsl,
  screenReflectionTilesWgsl,
} from '../../lighting/screenSpaceTracing/reflectionsWgsl.ts'

export const SCREEN_SPACE_TRACING_SHADERS: Record<string, string> = {
  SCREEN_SPACE_REFLECTION_TILES: screenReflectionTilesWgsl(),
  SCREEN_SPACE_REFLECTION_TEMPORAL: temporalWgsl(),
  SCREEN_SPACE_REFLECTION_COMPOSE: composeWgsl(),
  SCREEN_SPACE_HALF_RESOLUTION: halfResWgsl(),
  SCREEN_SPACE_REDUCTION_FIRST: prevFrameFirstWgsl(),
  SCREEN_SPACE_REDUCTION_LOWER: prevFrameLowerWgsl(),
  ...Object.fromEntries(
    [0, 1, 2, 3, 4].map((code) => [
      `SCREEN_SPACE_REFLECTIONS_${code}`,
      screenReflectionsWgsl(code),
    ]),
  ),
  ...Object.fromEntries(
    [1, 2, 3, 4].map((code) => [
      `SCREEN_SPACE_REFLECTIONS_DENOISED_${code}`,
      screenReflectionsWgsl(code, true),
    ]),
  ),
  SCREEN_SPACE_DENOISE_SPATIAL_REFLECTIONS_INPUT: denoiseSpatialWgsl('reflections', 'input'),
  SCREEN_SPACE_DENOISE_SPATIAL_REFLECTIONS_HISTORY: denoiseSpatialWgsl('reflections', 'history'),
  SCREEN_SPACE_DENOISE_SPATIAL_INDIRECT_INPUT: denoiseSpatialWgsl('indirect', 'input'),
  SCREEN_SPACE_DENOISE_ACCUMULATION_REFLECTIONS: denoiseAccumulationWgsl('reflections'),
  SCREEN_SPACE_DENOISE_ACCUMULATION_INDIRECT: denoiseAccumulationWgsl('indirect'),
  SCREEN_SPACE_DENOISE_KEEP: keepWgsl(),
  ...Object.fromEntries(
    [1, 2, 3, 4].map((level) => [`SCREEN_SPACE_DIFFUSE_${level}`, diffuseWgsl(level)]),
  ),
}
