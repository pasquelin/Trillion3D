import { retire } from '../core/frameRetire.ts'
import { arrayView } from '../core/textureViews.ts'
import { HIZ_DEPTH_LAYERS, HIZ_FRONT_LAYER, HIZ_OPAQUE_LAYER } from './pyramidTexture.ts'
import type { Pyramid } from './pyramid.ts'

// A pyramid's level 0 (`pyramid.ts`): the opaque depth, and the transparents' front layer beside it
// once a scene asks it.

/** The label of a pyramid's level 0. */
const HIZ_LEVEL0_LABEL = 'Trillion3D Hi-Z level 0'

/** Level 0 at `width × height` with `layers` layers — the opaque depth, then the front depth when
 *  there are `HIZ_DEPTH_LAYERS` —, and its views. */
export function level0Of(
  device: GPUDevice,
  usage: number,
  width: number,
  height: number,
  layers: number,
) {
  const level0 = device.createTexture({
    label: HIZ_LEVEL0_LABEL,
    size: { width, height, depthOrArrayLayers: layers },
    format: 'r32float',
    usage,
  })
  const layer = (baseArrayLayer: number) =>
    level0.createView({ dimension: '2d', baseArrayLayer, arrayLayerCount: 1 })
  return {
    level0,
    level0View: layer(HIZ_OPAQUE_LAYER),
    depthView: arrayView(level0),
    frontView: layers > HIZ_FRONT_LAYER ? layer(HIZ_FRONT_LAYER) : undefined,
  }
}

/**
 * `at`'s front layer, which this image's fold writes while `wanted`: made at the first ask — level 0
 * made again with two layers, in `encoder` the opaque depth this image drew copied into the first,
 * once, the one replaced retired after the frame (`retire`), its group and its readers' resources
 * made again at their next ask, which follow the views' identity —, then kept whatever the
 * transparents do: no texture is made, copied or bound again when they come and go. Whether the
 * readers fold it is the frame word `frontWritten` (`HIZ_FOLD_WGSL`): an image that does not write
 * it folds the opaque depth alone, bit for bit, so no reader folds the last glass; one that writes
 * it again finds it cleared first, as a layer made anew. Whether the word moved.
 */
export function holdFrontLayer(
  device: GPUDevice,
  usage: number,
  at: Pyramid,
  encoder: GPUCommandEncoder,
  wanted: boolean,
) {
  if (at.frontWritten === wanted) return false
  at.frontWritten = wanted
  if (!wanted) return (at.frontStale = true)
  if (!at.frontView) {
    const old = at.level0
    Object.assign(at, level0Of(device, usage, at.width, at.height, HIZ_DEPTH_LAYERS))
    encoder.copyTextureToTexture({ texture: old }, { texture: at.level0 }, [at.width, at.height, 1])
    retire(device, old)
    at.group = at.bound = at.depth = undefined
  } else if (at.frontStale)
    encoder
      .beginRenderPass({
        label: HIZ_LEVEL0_LABEL,
        colorAttachments: [
          { view: at.frontView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
        ],
      })
      .end()
  at.frontStale = false
  return true
}
