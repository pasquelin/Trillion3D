import { retire } from '../../gpu/core/frameRetire.ts'
import { madeTextureBytes } from '../../gpu/core/textureBytes.ts'

/**
 * A PAGE PICTURE HELD AS A TEXTURE: `of(image, mips)` is the texture `image` is copied into —
 * `format`, `mips` levels, the copy not premultiplied —, made at the first ask and again when the
 * page gives another picture object, the old one retired with the frame that may still name it.
 * `fresh` says whether the last `of` made it, the levels under the first still to be drawn;
 * `release` gives it back, `bytes` is what it holds. The metering mask and the bloom's dirt mask
 * are held so.
 */
export function heldImageTexture<Image extends { width: number; height: number }>(
  device: GPUDevice,
  label: string,
  format: GPUTextureFormat,
) {
  let held: { image: Image; texture: GPUTexture } | undefined
  let fresh = false
  const release = () => {
    if (held) retire(device, held.texture)
    held = undefined
  }
  return {
    /** Whether the last `of` made the texture. */
    get fresh() {
      return fresh
    },
    /** The texture of `image`, of `mips` levels when it is made. */
    of(image: Image, mips = 1) {
      fresh = held?.image !== image
      if (fresh) {
        release()
        const size = { width: image.width, height: image.height }
        const texture = device.createTexture({
          label,
          size,
          format,
          mipLevelCount: mips,
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
        })
        device.queue.copyExternalImageToTexture(
          { source: image as unknown as GPUCopyExternalImageSource },
          { texture, premultipliedAlpha: false },
          size,
        )
        held = { image, texture }
      }
      return held!.texture
    },
    /** Bytes of the texture. */
    get bytes() {
      return held ? madeTextureBytes(held.texture) : 0
    },
    release,
  }
}
