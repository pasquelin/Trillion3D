import { standInTexture } from '../../gpu/core/standInTexture.ts'
import { ATLAS_TEXTURE_FORMAT } from './layout.ts'

/**
 * What a program that reads the light functions is bound to where the image has none: one texel of
 * atlas, which has no table (an atlas with no row for an entry answers no light function,
 * `lightFunctionOf`). Made with the deferred placeholders.
 */
export function createLightFunctionStandIns(device: GPUDevice) {
  const atlas = standInTexture(
    device,
    'Trillion3D empty light function atlas',
    ATLAS_TEXTURE_FORMAT,
    { storage: true },
  )
  return {
    read: atlas.createView(),
    destroy() {
      atlas.destroy()
    },
  }
}
