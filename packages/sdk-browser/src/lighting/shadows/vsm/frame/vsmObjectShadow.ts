import { objectShadowHoldKey, type ObjectShadowFrame } from '../../perObject/objectShadowFrame.ts'
import { projectedLightRect } from '../projection/perLightScissor.ts'
import { PER_LIGHT_MASK_FORMAT } from '../projection/maskFormat.ts'
import type { VsmProjectionLight } from '../projection/projectionPass.ts'
import { sunCount } from '../projection/projectionView.ts'
import type { MaskContributor } from './maskContributors.ts'
import type { VsmFrame } from './vsmProject.ts'

/** The format of the capsule layers the one-pass projection reads (`capsuleLocalLayers`): a layer holds the square root of a light's share. */
const LAYER_FORMAT: GPUTextureFormat = 'r8unorm'

const lightRect = new Int32Array(4)

/** The frame whose subjects the contributor reads back, set by `objectShadowContributor`. */
let current: ObjectShadowFrame | undefined

/**
 * The translucent object shadows of the local lights on the one-pass path, taken into the layers the projection reads where it packs a light's share, a
 * view each light of the frame (`capsuleLocalLayers`): each light's subjects are read back over the pixels the light reaches, the minimum of what the layer holds.
 */
function encodeOnePassLocalObjectShadows(
  frame: VsmFrame,
  encoder: GPUCommandEncoder,
  translucent: ObjectShadowFrame,
  lights: readonly VsmProjectionLight[],
  layers: readonly GPUTextureView[],
) {
  if (!translucent.drawn) return
  const [width, height] = frame.rt.gpu.targetSize
  for (let k = sunCount(lights); k < Math.min(lights.length, layers.length); k++) {
    const light = lights[k]!
    if (
      light.type === 'directional' ||
      !translucent.projector.lights.has(light.mapId) ||
      !projectedLightRect(
        lightRect,
        0,
        light.position,
        light.radius,
        frame.cam.view,
        frame.projection,
        frame.cam.perspective === 1,
        width,
        height,
      )
    )
      continue
    translucent.projector.local(
      encoder,
      light.mapId,
      layers[k]!,
      [lightRect[0]!, lightRect[1]!, lightRect[2]!, lightRect[3]!],
      LAYER_FORMAT,
    )
  }
}

/** The one contributor of the translucent object shadows: the projector of the frame it was last given, read back into the masks. Held, so a frame allocates none. */
const contributor: MaskContributor = {
  // A local light's subjects read back into its layer of the per-light mask.
  local(encoder, light, layer, rect) {
    if (current?.drawn && light.type !== 'directional')
      current.projector.local(encoder, light.mapId, layer, rect, PER_LIGHT_MASK_FORMAT)
  },
  onePassLayer(frame, encoder, lights, layers) {
    if (current) encodeOnePassLocalObjectShadows(frame, encoder, current, lights, layers)
  },
  // The suns' subjects read back into their layers of the suns' mask, once the suns' projection is encoded.
  sun(encoder, lights, suns, sunMask) {
    if (!current?.drawn) return
    for (let layer = 0; layer < suns; layer++)
      current.projector.sun(encoder, lights[layer]!.mapId, sunMask)
  },
  get holdKey() {
    return current ? objectShadowHoldKey(current) : 0
  },
}

/** The contributor of the translucent object shadows of `translucent`, to register with the projector. */
export function objectShadowContributor(translucent: ObjectShadowFrame): MaskContributor {
  current = translucent
  return contributor
}
