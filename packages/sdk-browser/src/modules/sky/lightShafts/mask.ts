import { FOG_VIEW_SLOT } from '../../../lighting/fog/viewSlots.ts'
import { putVec4 } from '../../../gpu/core/fieldLayout.ts'
import { lightShaftBounds, type LightShaftSizes } from './layout.ts'

/** Floats the mask's two slots of the fog's view block hold. */
export const LIGHT_SHAFT_MASK_FLOATS = 8

/** The byte offset of the mask's slots in the fog's view block. */
export const LIGHT_SHAFT_MASK_BLOCK_AT = FOG_VIEW_SLOT.lightShaftBounds * 16

/**
 * What the fog's read needs of the occlusion mask, written into the two slots after the volume's
 * (`FOG_VIEW_SLOT.lightShaftBounds`, `lightShaftScene`) into `out`, `LIGHT_SHAFT_MASK_FLOATS`
 * floats: the bounds of the mask's reads, `(minX, minY, maxX, maxY)` in texture coordinates
 * (`lightShaftBounds`), and the scene's texture size in `xy`, its inverse in `zw`.
 */
export function writeLightShaftMaskSlots(out: Float32Array<ArrayBuffer>, sizes: LightShaftSizes) {
  const { texture } = sizes.scene
  out.set(lightShaftBounds(sizes.shaft), 0)
  putVec4(out, 4, texture.width, texture.height, 1 / texture.width, 1 / texture.height)
  return out
}
