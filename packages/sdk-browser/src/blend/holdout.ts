import { HDR_FORMAT } from '../scene/targetFormats.ts'
import { LIGHT_THROUGH, SCALED_BY_ALPHA } from '../materials/surface/materialBlending.ts'

/**
 * THE ALPHA HOLDOUT'S TARGET: what the translucent layers leave of the background visible, red,
 * green and blue alike, and the share of the path they let through, in alpha. It starts as the lit
 * image's alpha with a throughput of 1 (`copyHoldoutStart`) and each layer, far to near, lays its
 * output over it (`holdoutStageText`, `holdoutWgsl.ts`): `visibility = add + visibility · through`,
 * `throughput = throughput · through`. The visibility it ends with is the image's alpha
 * (`applyHoldout`). Both passes are `holdoutPasses.ts`'s.
 */
export const HOLDOUT_FORMAT: GPUTextureFormat = HDR_FORMAT

/** The holdout target of `targets`, made the first time it is asked, the size of the translucency
 *  target it goes with. */
export function holdoutTargetOf(
  device: GPUDevice,
  targets: {
    color: GPUTexture
    holdout?: { texture: GPUTexture; view: GPUTextureView; pending: boolean }
  },
) {
  if (!targets.holdout) {
    const texture = device.createTexture({
      label: 'Trillion3D alpha holdout',
      size: { width: targets.color.width, height: targets.color.height },
      format: HOLDOUT_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    targets.holdout = { texture, view: texture.createView(), pending: false }
  }
  return targets.holdout.view
}

/** The holdout target as a layer writes it: the output's red, green and blue added, the destination
 *  multiplied by its alpha, and the throughput multiplied by it. */
export const HOLDOUT_TARGET: GPUColorTargetState = {
  format: HOLDOUT_FORMAT,
  blend: {
    color: LIGHT_THROUGH,
    alpha: SCALED_BY_ALPHA,
  },
}
