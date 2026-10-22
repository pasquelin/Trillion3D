import type { BloomDirtImage } from '../../../../../sdk-core/src/contracts/bloomDirtOptions.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { madeTextureBytes } from '../../../gpu/core/textureBytes.ts'
import { BLOOM_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { downsampleGroup } from '../../filters/downsampleChain.ts'
import { DOWNSAMPLE_BYTES } from '../../filters/downsampleWgsl.ts'
import { fullscreenDraw } from '../../filters/fullscreenDraw.ts'
import { glowPrograms } from './glowPrograms.ts'

/** The format the dirt mask is held in: a picture of display colours, read as linear light. */
const DIRT_FORMAT: GPUTextureFormat = 'rgba8unorm-srgb'

/** The mip levels of a picture `width × height` texels: down to one texel. */
const levelsOf = (width: number, height: number) =>
  Math.floor(Math.log2(Math.max(width, height))) + 1

/**
 * Draws the mip levels 1 to `levels − 1` of `texture` in `encoder`, each the mean of four texels of
 * the one above (the downsample's `halve`, through the glow's programs).
 */
function drawLevels(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  texture: GPUTexture,
  levels: number,
) {
  const { filters } = glowPrograms(device)
  const draw = fullscreenDraw(BLOOM_PASS)
  const pipeline = filters.pipeline('halve', DIRT_FORMAT).get()
  const words = new Float32Array(4)
  const sizeAt = (level: number) => [
    Math.max(1, texture.width >> level),
    Math.max(1, texture.height >> level),
  ]
  for (let level = 1; level < levels; level++) {
    const [above, size] = [sizeAt(level - 1), sizeAt(level)]
    words.set([1 / above[0], 1 / above[1], 1 / size[0], 1 / size[1]])
    const uniform = device.createBuffer({
      label: BLOOM_PASS,
      size: DOWNSAMPLE_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(uniform, 0, words)
    const reads = texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 })
    const group = downsampleGroup(device, filters, reads, uniform)
    draw(encoder, texture.createView({ baseMipLevel: level, mipLevelCount: 1 }), pipeline, group)
    retire(device, uniform)
  }
}

/**
 * THE DIRT MASK ON THE DEVICE: the picture the page gave, copied into a texture, each mip level the
 * mean of four texels of the one above (`drawLevels`), so a mask larger than the image is read at
 * the level its size asks, not at its own. Made at the first image that shows it and again when the
 * page gives another picture.
 */
export function createDirtMask(device: GPUDevice) {
  let held: { image: BloomDirtImage; texture: GPUTexture; view: GPUTextureView } | undefined
  return {
    /** The mask's view: `image` copied into a texture, with its mip levels drawn in `encoder`, when
     *  it is not the picture the last call held. */
    view(encoder: GPUCommandEncoder, image: BloomDirtImage) {
      if (held?.image === image) return held.view
      if (held) retire(device, held.texture)
      const levels = levelsOf(image.width, image.height)
      const texture = device.createTexture({
        label: BLOOM_PASS,
        size: { width: image.width, height: image.height },
        format: DIRT_FORMAT,
        mipLevelCount: levels,
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      })
      device.queue.copyExternalImageToTexture(
        { source: image as unknown as GPUCopyExternalImageSource },
        { texture, premultipliedAlpha: false },
        { width: image.width, height: image.height },
      )
      drawLevels(device, encoder, texture, levels)
      held = { image, texture, view: texture.createView() }
      return held.view
    },
    /** Bytes of the mask's texture. */
    get bytes() {
      return held ? madeTextureBytes(held.texture) : 0
    },
    /** The texture given back: the page set no mask. */
    release() {
      if (held) retire(device, held.texture)
      held = undefined
    },
  }
}
