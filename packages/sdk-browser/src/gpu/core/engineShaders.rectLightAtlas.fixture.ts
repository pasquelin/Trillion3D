// The rectangle lights' atlas WGSL texts of `ENGINE_SHADERS`: the passes that draw a picture into the atlas, copy a slot from the old atlas to
// the new one, filter a slot's mip levels, clear the atlas, and the debug view that draws the atlas and lays it over the image.
import { DEBUG_WGSL } from '../../lighting/rectLightAtlas/debugWgsl.ts'
import { BLIT_WGSL } from '../../lighting/overlayWgsl.ts'
import { PROFILE_DEBUG_WGSL } from '../../lighting/lightProfile/debugWgsl.ts'
import {
  ADD_WGSL,
  CLEAR_WGSL,
  COPY_WGSL,
  FILTER_WGSL,
} from '../../lighting/rectLightAtlas/passWgsl.ts'

export const RECT_LIGHT_ATLAS_SHADERS: Record<string, string> = {
  RECT_ATLAS_ADD: ADD_WGSL,
  RECT_ATLAS_COPY: COPY_WGSL,
  RECT_ATLAS_FILTER: FILTER_WGSL,
  RECT_ATLAS_CLEAR: CLEAR_WGSL,
  RECT_ATLAS_DEBUG: DEBUG_WGSL,
  OVERLAY_BLIT: BLIT_WGSL,
  LIGHT_PROFILE_DEBUG: PROFILE_DEBUG_WGSL,
}
