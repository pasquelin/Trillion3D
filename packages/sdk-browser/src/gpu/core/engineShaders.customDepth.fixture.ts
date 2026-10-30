// The custom depth's WGSL text of `ENGINE_SHADERS`: the emission of the depth and stencil from the visibility of the objects that ask for them.
import { CUSTOM_DEPTH_EMIT_WGSL } from '../../visibility/customDepth/customDepthWgsl.ts'

export const CUSTOM_DEPTH_SHADERS: Record<string, string> = {
  CUSTOM_DEPTH_EMIT: CUSTOM_DEPTH_EMIT_WGSL,
}
