/**
 * THE LAST LIT IMAGE OF A VIEW, which the next image reads where a ray meets the screen: the HDR target
 * the last image lit, kept whole while the next image lights the other — the two targets take turns,
 * references traded, nothing copied (`adoptLitImage`) —, and what it was drawn with (`HeldImage`). It
 * is read as it is, one texel at its level 0 (`reflectionImage`); no filtered level is built.
 */
import { copyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { textureBytesOf } from '../../gpu/core/textureBytes.ts'
import { HDR_FORMAT, hdrTargetDescriptor } from '../../scene/targetFormats.ts'

/** What a view holds of the image it keeps: whether it holds an image of this view, and the
 *  view-projection, drawn size and pre-exposure that image was drawn with — the next image
 *  reprojects its hits with the first two, and divides the light it reads by the last —, the
 *  jitter its view-projection carried, in device units, and the reflections' image it was (`image`,
 *  `ReflectionFrame.image`; -1 for none). */
export type HeldImage = {
  valid: boolean
  viewProjection: Float64Array
  size: [number, number]
  preExposure: number
  jitter: [number, number]
  image: number
}

/** Whether the vectors image \`image\` drew — its surfaces' motion since the image before — reach
 *  back to the image \`held\` keeps: it is the image just before. */
export const vectorsReach = (held: HeldImage, image: number) =>
  held.valid && held.image === image - 1

/** Bytes of the other HDR target of a view at `width × height`: the frame's own is counted with the
 *  frame's targets (`frameTargetBytes`). */
export const litImageBytes = (width: number, height: number) =>
  textureBytesOf({ size: [width, height], format: HDR_FORMAT })!

/**
 * The lit image of a view at `width × height`: the HDR target the last image lit (`image`, which
 * `adoptLitImage` swaps with the frame's), and what it holds (`held`: none yet — not valid, no
 * view-projection, no size).
 */
export function createLitImage(device: GPUDevice, width: number, height: number) {
  const texture = device.createTexture(hdrTargetDescriptor(width, height))
  return {
    image: { texture, view: texture.createView() },
    /** The frame's HDR target was kept as this image (`holdLitImage`) and is to become `image` once the
     *  image is encoded (`adoptLitImage`). */
    fresh: false,
    held: {
      valid: false,
      viewProjection: new Float64Array(16),
      size: [0, 0],
      preExposure: 1,
      jitter: [0, 0],
      image: -1,
    } as HeldImage,
  }
}
export type LitImage = ReturnType<typeof createLitImage>

/** The HDR target of a frame and the reflection it lights (`WebgpuGpuState`'s). */
type LitTargets = {
  hdrTexture?: GPUTexture
  hdrView?: GPUTextureView
  reflection?: { lit: LitImage }
}

/**
 * The frame's HDR target is the image this view keeps for the next one: its view-projection, drawn
 * `size`, `preExposure`, the `jitter` of its view-projection and its reflections' `image` held, to be
 * adopted once every pass of the image that reads or writes the target is encoded (`adoptLitImage`).
 * Called once the image is lit, before its temporal resolve.
 */
export function holdLitImage(
  lit: LitImage,
  viewProjection: ArrayLike<number>,
  size: readonly [number, number],
  preExposure = 1,
  jitter: readonly [number, number] = [0, 0],
  image = -1,
) {
  const { held } = lit
  held.valid = true
  copyMatrix4(held.viewProjection, viewProjection)
  held.size[0] = size[0]
  held.size[1] = size[1]
  held.preExposure = preExposure
  held.jitter[0] = jitter[0]
  held.jitter[1] = jitter[1]
  held.image = image
  lit.fresh = true
}

/**
 * The image is encoded: the HDR target held (`fresh`) becomes the view's lit image, which the next
 * image's reflections read, and the one that was the lit image becomes the HDR target the next image
 * lights. References traded, nothing copied, nothing made: what every pass of this image recorded stays
 * on the textures it named. Called once every pass of the image that reads or writes the HDR target is
 * encoded (`encodeSurfaceLighting`).
 */
export function adoptLitImage(gpu: LitTargets) {
  const lit = gpu.reflection?.lit
  if (!lit?.fresh || !gpu.hdrTexture || !gpu.hdrView) return
  const { image } = lit,
    texture = image.texture,
    view = image.view
  image.texture = gpu.hdrTexture
  image.view = gpu.hdrView
  gpu.hdrTexture = texture
  gpu.hdrView = view
  lit.fresh = false
}
