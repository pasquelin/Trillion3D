import type { BloomKernelImage } from '../../../../../../sdk-core/src/contracts/bloomConvolutionOptions.ts'
import { retire } from '../../../../gpu/core/frameRetire.ts'
import { madeTextureBytes } from '../../../../gpu/core/textureBytes.ts'
import { BLOOM_PASS } from '../../../../diagnostic/stage/passLabels.ts'
import { RESIZED_FORMAT } from './kernelWgsl.ts'

/** The textures a rebuild of the kernel's spectrum draws through (`createTransients`). */
export type KernelTransients = ReturnType<typeof createTransients>

/**
 * THE TEXTURES A REBUILD OF THE KERNEL'S SPECTRUM DRAWS THROUGH: the kernel's picture, uploaded, and
 * each image the preparation makes of it, one slot for each in the order they are asked (`next`).
 * A rebuild asks the same sizes while the plan and the kernel hold, so a slot is made again only
 * when its size moves; `release` gives them all back — what the caller does where the spectrum is
 * kept, which no rebuild follows, and leaves undone where it is made again at every image.
 */
export function createTransients(device: GPUDevice) {
  type Slot = { texture: GPUTexture; width: number; height: number; format: GPUTextureFormat }
  const slots: Slot[] = []
  let asked = 0,
    uploaded: BloomKernelImage | undefined
  const next = (width: number, height: number, format: GPUTextureFormat, usage: number) => {
    const held = slots[asked]
    if (held?.width === width && held.height === height && held.format === format)
      return slots[asked++].texture
    if (held) retire(device, held.texture)
    const texture = device.createTexture({
      label: BLOOM_PASS,
      size: { width, height },
      format,
      usage: usage | GPUTextureUsage.TEXTURE_BINDING,
    })
    slots[asked++] = { texture, width, height, format }
    if (asked === 1) uploaded = undefined
    return texture
  }
  return {
    /** Starts a rebuild: the first slot is asked next. */
    begin() {
      asked = 0
    },
    /** The picture `image`, uploaded: the first slot, written again only for another picture. */
    picture(image: BloomKernelImage) {
      const texture = next(image.width, image.height, RESIZED_FORMAT, GPUTextureUsage.COPY_DST)
      if (uploaded !== image) {
        const pixels = image.pixels as Float32Array<ArrayBuffer>
        device.queue.writeTexture(
          { texture },
          pixels,
          { bytesPerRow: 16 * image.width, rowsPerImage: image.height },
          { width: image.width, height: image.height },
        )
        uploaded = image
      }
      return texture
    },
    /** An image the preparation writes and reads, `width × height` of `format`. */
    image: (width: number, height: number, format: GPUTextureFormat) =>
      next(width, height, format, GPUTextureUsage.STORAGE_BINDING),
    /** Ends a rebuild: the slots it did not ask are given back. */
    end() {
      for (const { texture } of slots.splice(asked)) retire(device, texture)
    },
    release() {
      for (const { texture } of slots) retire(device, texture)
      slots.length = 0
      uploaded = undefined
    },
    get bytes() {
      return slots.reduce((sum, { texture }) => sum + madeTextureBytes(texture), 0)
    },
  }
}
