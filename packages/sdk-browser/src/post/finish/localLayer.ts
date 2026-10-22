import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { madeTextureBytes } from '../../gpu/core/textureBytes.ts'

/**
 * ONE KEPT IMAGE OF THE LOCAL EXPOSURE: its texture and view, made again when its size moves, and
 * the `group` of the pass that reads or writes it, which the caller makes again when `moved` says
 * the image it names changed — the layer's own, or the one the pass reads from. A frame allocates
 * none. `describe` is the texture of a size, `dimension` the dimension its view is of.
 */
export function createLayer(
  device: GPUDevice,
  describe: (width: number, height: number) => GPUTextureDescriptor,
  dimension?: GPUTextureViewDimension,
) {
  const identity = createWebgpuBindIdentity()
  let texture: GPUTexture | undefined,
    view: GPUTextureView | undefined,
    size = [0, 0]
  const layer = {
    /** The group of the pass, `undefined` until the caller makes it. */
    group: undefined as GPUBindGroup | undefined,
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
    /** Whether the group must be made again: the image it names moved, `source` the one the pass
     *  reads — taken as the one the group names from now on — or the layer's own. */
    moved(source: GPUTextureView) {
      identity.next[0] = source
      identity.next[1] = view
      return identity.moved()
    },
    /** Gives the image back, retired with the frame that may still name it. */
    release() {
      if (texture) retire(device, texture)
      texture = view = layer.group = undefined
      size = [0, 0]
      identity.clear()
    },
  }
  return layer
}
