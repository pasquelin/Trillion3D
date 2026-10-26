import type { ExposureMeterMaskImage } from '../../../../sdk-core/src/contracts/exposureMeterMask.ts'
import { EXPOSURE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { heldImageTexture } from '../filters/heldImage.ts'

/** The format the mask is held in: plain numbers, as the weights it holds are read. */
const MASK_FORMAT: GPUTextureFormat = 'rgba8unorm'

/**
 * THE METERING MASK ON THE DEVICE (`exposureMeterMask.ts`): the picture the page gave, copied into
 * one texture of a single level, which the measure reads bilinearly at LOD 0. Made at the first
 * image that meters with it and again when the page gives another picture; none where the page set
 * none, the meter then holding no texture for it.
 */
export function createMeterMask(device: GPUDevice) {
  const held = heldImageTexture<ExposureMeterMaskImage>(device, EXPOSURE_PASS, MASK_FORMAT)
  let view: GPUTextureView | undefined
  return {
    /** The view of `image` copied into a texture, made when it is not the picture the last call
     *  held. */
    view(image: ExposureMeterMaskImage) {
      const texture = held.of(image)
      if (held.fresh) view = texture.createView()
      return view!
    },
    /** The texture given back: the page set no mask, or the meter is gone. */
    release: held.release,
  }
}
