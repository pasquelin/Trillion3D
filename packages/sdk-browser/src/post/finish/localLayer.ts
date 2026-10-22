import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { madeTextureBytes } from '../../gpu/core/textureBytes.ts'

/**
 * ONE KEPT IMAGE OF THE LOCAL EXPOSURE: its texture and view, made again when its size moves, and
 * the bind group of the pass that reads or writes it, made again (`groupOver`) when the image it
 * names changed — the layer's own, or the one the pass reads from. A frame allocates none.
 * `describe` is the texture of a size, `dimension` the dimension its view is of.
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
