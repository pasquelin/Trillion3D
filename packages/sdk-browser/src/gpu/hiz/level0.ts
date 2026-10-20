import { arrayView, layerView } from '../core/textureViews.ts'
import { HIZ_DEPTH_LAYERS, HIZ_FRONT_LAYER, HIZ_OPAQUE_LAYER } from './pyramidTexture.ts'

// A pyramid's level 0 (`pyramid.ts`): the opaque depth, and the transparents' front layer beside it,
// both made with the pyramid; whether a reader folds the front layer is a frame word
// (`Pyramid.frontWritten`), so no texture is made, copied or bound again when transparents come.

/** The format of a pyramid's level 0, every layer: the depth the visibility and the front pass write. */
export const HIZ_LEVEL0_FORMAT: GPUTextureFormat = 'r32float'

/** The label of a pyramid's level 0. */
const HIZ_LEVEL0_LABEL = 'Trillion3D Hi-Z level 0'

/** Level 0 at `width × height`, its `HIZ_DEPTH_LAYERS` layers — the opaque depth, then the front
 *  depth —, and its views. */
export function level0Of(device: GPUDevice, usage: number, width: number, height: number) {
  const level0 = device.createTexture({
    label: HIZ_LEVEL0_LABEL,
    size: { width, height, depthOrArrayLayers: HIZ_DEPTH_LAYERS },
    format: HIZ_LEVEL0_FORMAT,
    usage,
  })
  return {
    level0,
    level0View: layerView(level0, HIZ_OPAQUE_LAYER),
    depthView: arrayView(level0),
    frontView: layerView(level0, HIZ_FRONT_LAYER),
  }
}
