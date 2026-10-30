// The toon profiles' WGSL text of `ENGINE_SHADERS`: the bake of a profile's images into the patterns the lights read.
import { TOON_BAKE_WGSL } from '../../lighting/toon/bakeWgsl.ts'

export const TOON_SHADERS: Record<string, string> = {
  TOON_BAKE: TOON_BAKE_WGSL,
}
