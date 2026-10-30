// The planar reflections' WGSL texts of `ENGINE_SHADERS`: the prefilter of the mirrored view's image and the composite over the reflection target.
import {
  PLANAR_COMPOSITE_CODE,
  PLANAR_PREFILTER_CODE,
} from '../../lighting/planarReflection/wgsl.ts'

export const PLANAR_REFLECTION_SHADERS: Record<string, string> = {
  PLANAR_REFLECTION_PREFILTER: PLANAR_PREFILTER_CODE,
  PLANAR_REFLECTION_COMPOSITE: PLANAR_COMPOSITE_CODE,
}
