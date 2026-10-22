import type { BloomDirtImage } from '../../../../../sdk-core/src/contracts/bloomDirtOptions.ts'
import { mipSize } from '../../../../../math/src/scalar/integers.ts'
import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { madeTextureBytes } from '../../../gpu/core/textureBytes.ts'
import { BLOOM_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { mipLevelCountFor } from '../../../materials/texture/tiles.ts'
import { downsampleGroup, downsampleUniform } from '../../filters/downsampleChain.ts'
import { filterPrograms } from '../../filters/filterPrograms.ts'
import { fullscreenDraw } from '../../filters/fullscreenDraw.ts'

/** The format the dirt mask is held in: a picture of display colours, read as linear light. */
const DIRT_FORMAT: GPUTextureFormat = 'rgba8unorm-srgb'

/**
 * The mip level a mask of `mask` texels is read at over an image of `image` texels, as the GPU
 * picks it from the mask's texels one pixel of the image steps over — the larger of the two ratios,
 * its logarithm, rounded —, no finer than the mask itself and no coarser than its last level.
 */
export function dirtLevel(mask: BloomDirtImage, image: readonly number[]) {
  const ratio = Math.max(mask.width / image[0], mask.height / image[1])
  return clamp(Math.round(Math.log2(ratio)), 0, mipLevelCountFor(mask.width, mask.height) - 1)
}

/**
 * Draws the mip levels 1 to `levels − 1` of `texture` in `encoder`, each the mean of four texels of
 * the one above (the downsample's `halve`).
 */
function drawLevels(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  texture: GPUTexture,
  levels: number,
) {
  const filters = filterPrograms(device)
  const draw = fullscreenDraw(BLOOM_PASS)
  const pipeline = filters.pipeline('halve', DIRT_FORMAT).get()
  const sizeAt = (level: number) => [mipSize(texture.width, level), mipSize(texture.height, level)]
  for (let level = 1; level < levels; level++) {
    const uniform = downsampleUniform(device, BLOOM_PASS, sizeAt(level), sizeAt(level - 1))
    const reads = texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 })
    const group = downsampleGroup(device, filters, reads, uniform)
    draw(encoder, texture.createView({ baseMipLevel: level, mipLevelCount: 1 }), pipeline, group)
    retire(device, uniform)
  }
}

/**
 * THE DIRT MASK ON THE DEVICE: the picture the page gave, copied into a texture, each mip level the
 * mean of four texels of the one above (`drawLevels`), so a mask larger than the image is read at
 * the level its size asks (`dirtLevel`), not at its own: through a view of that level alone, so the
 * composition reads it as it reads any image. Made at the first image that shows it and again when
 * the page gives another picture.
 */
export function createDirtMask(device: GPUDevice) {
  let held:
    | { image: BloomDirtImage; texture: GPUTexture; views: (GPUTextureView | undefined)[] }
    | undefined
  const release = () => {
    if (held) retire(device, held.texture)
    held = undefined
  }
  return {
    /** The view of the mask's level `level`: `image` copied into a texture, with its mip levels
     *  drawn in `encoder`, when it is not the picture the last call held. */
    view(encoder: GPUCommandEncoder, image: BloomDirtImage, level: number) {
      if (held?.image !== image) {
        release()
        const levels = mipLevelCountFor(image.width, image.height)
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
        held = { image, texture, views: [] }
      }
      return (held.views[level] ??= held.texture.createView({
        baseMipLevel: level,
        mipLevelCount: 1,
      }))
    },
    /** Bytes of the mask's texture. */
    get bytes() {
      return held ? madeTextureBytes(held.texture) : 0
    },
    /** The texture given back: the page set no mask. */
    release,
  }
}
