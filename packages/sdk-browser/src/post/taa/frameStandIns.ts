import { standInTexture } from '../../gpu/core/standIns.ts'
import { RESPONSIVE_FORMAT } from '../../blend/responsive.ts'
import { createNoTranslucency } from '../../blend/translucencyLayers.ts'

/** What a frame reads where its blends carry nothing: no responsiveness, from one texel of zero,
 *  and no translucency, no light and a transmittance of 1. */
export function createStandIns(device: GPUDevice) {
  const responsive = standInTexture(device, 'Trillion3D TAA no responsiveness', RESPONSIVE_FORMAT)
  const translucency = createNoTranslucency(device)
  return {
    responsive: responsive.createView(),
    translucency: translucency.createView(),
    destroy() {
      responsive.destroy()
      translucency.destroy()
    },
  }
}
