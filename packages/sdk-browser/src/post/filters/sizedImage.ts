import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { madeTextureBytes } from '../../gpu/core/textureBytes.ts'

/** One image: its texture and the view the passes name — every mip level of it. */
export interface Image {
  readonly texture: GPUTexture
  readonly view: GPUTextureView
}
/** An image of several mip levels, and a view of each. */
export interface MippedImage extends Image {
  readonly levels: readonly GPUTextureView[]
}

/** An image labelled `label`, in a texture of `size`, `format` and `usage`, of `mips` levels: the one
 *  maker of the images a pass holds beside those that follow a size (`sizedImage`). */
export function imageOf(
  device: GPUDevice,
  label: string,
  size: readonly number[],
  format: GPUTextureFormat,
  usage: GPUTextureUsageFlags,
  mips = 1,
): MippedImage {
  const texture = device.createTexture({
    label,
    size: { width: size[0], height: size[1] },
    format,
    usage,
    mipLevelCount: mips,
  })
  const levels = Array.from({ length: mips }, (_, at) =>
    texture.createView({ baseMipLevel: at, mipLevelCount: 1 }),
  )
  return { texture, view: texture.createView(), levels }
}

/**
 * THE ENGINE'S ONE KEPT IMAGE: a texture and its view, made again when its size moves, the old one
 * retired — the image being encoded may still name it —, and the bind group of the pass that reads
 * or writes it, made again (`groupOver`) when the image it names changed — the layer's own, or the one
 * the pass reads from. A frame allocates none. `describe` is the texture of a size, `dimension` the
 * dimension its view is of. The local exposure's layers, the velocity stage's targets and
 * `sizedImage`'s pictures are all kept by it.
 */
export function createLayer(
  device: GPUDevice,
  describe: (width: number, height: number) => GPUTextureDescriptor,
  dimension?: GPUTextureViewDimension,
) {
  const identity = createWebgpuBindIdentity()
  let texture: GPUTexture | undefined,
    view: GPUTextureView | undefined,
    group: GPUBindGroup | undefined,
    size = [0, 0]
  return {
    /** The image, none before the first `fit`. */
    get view() {
      return view
    },
    /** Bytes of the image. */
    get bytes() {
      return texture ? madeTextureBytes(texture) : 0
    },
    /** Makes the image `width × height` texels, made again when the size moves. */
    fit(width: number, height: number) {
      if (size[0] === width && size[1] === height) return
      if (texture) retire(device, texture)
      size = [width, height]
      texture = device.createTexture(describe(width, height))
      view = texture.createView(dimension && { dimension })
    },
    /** The group of the pass over `source`, the image it reads — taken as the one the group names
     *  from now on — and the layer's own: `make` makes it, from them, when either moved. */
    groupOver(
      source: GPUTextureView,
      make: (source: GPUTextureView, own: GPUTextureView) => GPUBindGroup,
    ) {
      identity.next[0] = source
      identity.next[1] = view
      if (identity.moved()) group = make(source, view!)
      return group!
    },
    /** Gives the image back, retired with the frame that may still name it. */
    release() {
      if (texture) retire(device, texture)
      texture = view = group = undefined
      size = [0, 0]
      identity.clear()
    },
  }
}

/**
 * A 2D IMAGE MADE AT THE SIZE ASKED, of one `format` and `usage` (and `TEXTURE_BINDING`, which it is
 * read through), kept by `createLayer`: `view(width, height)` is the one image of that size, made at
 * the first ask and again when the size moves, `release` gives it back, `bytes` is what it holds. The
 * bloom's setup, the convolution's input and glow, the depth of field's images and the chain's pass
 * targets are such images.
 */
export function sizedImage(
  device: GPUDevice,
  label: string,
  format: GPUTextureFormat,
  usage: GPUTextureUsageFlags,
) {
  const layer = createLayer(device, (width, height) => ({
    label,
    size: { width, height },
    format,
    usage: usage | GPUTextureUsage.TEXTURE_BINDING,
  }))
  return {
    view(width: number, height: number) {
      layer.fit(width, height)
      return layer.view!
    },
    get bytes() {
      return layer.bytes
    },
    release: layer.release,
  }
}
