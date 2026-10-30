import { DEPTH_FORMAT } from '../../scene/targetFormats.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { CUSTOM_DEPTH_PASS } from '../../diagnostic/stage/passLabels.ts'
import { CUSTOM_STENCIL_FORMAT } from './customDepthWgsl.ts'

/** A target and its view. */
interface Target {
  readonly texture: GPUTexture
  readonly view: GPUTextureView
}

const target = (
  device: GPUDevice,
  label: string,
  format: GPUTextureFormat,
  size: readonly [number, number],
): Target => {
  const texture = device.createTexture({
    label,
    size: { width: size[0], height: size[1] },
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  })
  return { texture, view: texture.createView() }
}

/**
 * THE CUSTOM DEPTH OF A VIEW: a depth target, cleared to the far (0, the depth being reversed), and beside it, where the mode writes the
 * stencil, a stencil target of two 16-bit channels (`CUSTOM_STENCIL_FORMAT`), both the size of the view's image. They are made when an
 * object asks (`ensure`), made again where the size or the stencil mode moves, and given back (`release`) when no object asks in the
 * mode that gives them back; a target is retired, never destroyed, as the images in flight may name it. A pass that reads them takes
 * the views, none while they are not made.
 */
export function createCustomDepthTargets() {
  let depth: Target | undefined
  let stencil: Target | undefined
  let size: readonly [number, number] = [0, 0]
  const drop = (device: GPUDevice) => {
    if (depth) retire(device, depth.texture)
    if (stencil) retire(device, stencil.texture)
    depth = stencil = undefined
  }
  return {
    get depthView() {
      return depth?.view
    },
    get stencilView() {
      return stencil?.view
    },
    get size() {
      return size
    },
    /** Makes the targets of an image of `width × height` (and the stencil where `withStencil`); true when they were made again. */
    ensure(device: GPUDevice, width: number, height: number, withStencil: boolean) {
      if (depth && size[0] === width && size[1] === height && !!stencil === withStencil)
        return false
      drop(device)
      size = [width, height]
      depth = target(device, `${CUSTOM_DEPTH_PASS} depth`, DEPTH_FORMAT, size)
      if (withStencil)
        stencil = target(device, `${CUSTOM_DEPTH_PASS} stencil`, CUSTOM_STENCIL_FORMAT, size)
      return true
    },
    /** Gives the targets back. */
    release: drop,
  }
}

/** A view's custom depth targets (`createCustomDepthTargets`). */
export type CustomDepthTargets = ReturnType<typeof createCustomDepthTargets>
