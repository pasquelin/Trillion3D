import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { sizedImage } from './filters/sizedImage.ts'
import { holdoutOn } from '../frame/prepare/alphaHoldout.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { viewState } from '../frame/backend/state/viewState.ts'

/**
 * THE VOLUMES' HOLDOUT: the opacity the volumes that hold out lay over the image, a value a render
 * texel, which the pass that composes the volumes over the lit image adds to the alpha it leaves
 * (`alpha = surface alpha · transmittance + holdout`). It is another target than the translucent
 * layers' (`../blend/holdout.ts`), which is a render target accumulated by blending and laid over the
 * image before the volumes are drawn: a volume's step adds the opacity it gained to the pixel it
 * marches (`holdoutAdd`), read and written by the one thread of that pixel.
 *
 * It exists only while the alpha holdout is in effect (`holdoutOn`), and is given back the first
 * image it is not: an image without the holdout, or without a volume that holds out (whose pass
 * never asks), makes none.
 */

/** The holdout's format: one 32-bit float, the one single-channel format a compute pass reads and
 *  writes in the core of WebGPU (`read_write` storage). */
export const VOLUME_HOLDOUT_FORMAT = 'r32float'

/** What a pass that adds to the volumes' holdout binds: the target (`VOLUME_HOLDOUT_FORMAT`, the
 *  render grid `size`), which is cleared to zero once an image (`clearVolumeHoldout`) before the
 *  first volume adds to it, and read by the composition as an unfilterable float texture (a
 *  `textureLoad`, no sampler). Its texture is kept by `sizedImage`: made again where the grid moved,
 *  the old one retired with the frame that may still name it. */
export interface VolumeHoldout {
  readonly view: GPUTextureView
  readonly format: typeof VOLUME_HOLDOUT_FORMAT
  readonly size: readonly number[]
}

/** The view's kept image, by the view's gpu state, let go with the view (the image retires its
 *  texture). Its texture is the device's to free when the holdout ends (`volumeHoldoutOf`) and with
 *  the device. */
const held = viewState<ReturnType<typeof sizedImage>>((image) => image.release())

/**
 * The target the volumes of this image add their holdout to, or none where the alpha holdout is not
 * in effect (the caller binds nothing and runs no pass). Made the first time it is asked, at the
 * render grid, and again where that moved; given back the first image the holdout is not in effect.
 */
export function volumeHoldoutOf(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
): VolumeHoldout | undefined {
  const [width, height] = rt.gpu.targetSize
  if (!holdoutOn(rt) || !(width > 0 && height > 0)) {
    held.get(rt.gpu)?.release()
    return undefined
  }
  let image = held.get(rt.gpu)
  if (!image) {
    image = sizedImage(
      device,
      'Trillion3D volume holdout',
      VOLUME_HOLDOUT_FORMAT,
      GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    )
    held.set(rt.gpu, image)
  }
  return { view: image.view(width, height), format: VOLUME_HOLDOUT_FORMAT, size: rt.gpu.targetSize }
}

/** Clears the holdout to zero, once an image before the first volume adds to it. */
export function clearVolumeHoldout(encoder: GPUCommandEncoder, target: VolumeHoldout) {
  encoder
    .beginRenderPass({
      label: 'Trillion3D volume holdout clear',
      colorAttachments: [
        { view: target.view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
      ],
    })
    .end()
}

/**
 * `holdoutAdd(p, delta)`: adds `delta` — the opacity a step of a volume gained, the luminance of the
 * transmittance before it less the one after — to the holdout of texel `p`, in the render grid: a
 * load, then a store. The block declares the texture, `holdout`, at the `group` and `binding` the
 * program's layout gives it (`read_write`, the one access in which a compute pass loads and stores a
 * texel). It is no atomic: the pass must give each pixel to one invocation, as the volumes' march
 * does, and add to it before the pass that composes them reads it.
 */
export const holdoutAddWgsl = (group: number, binding: number) =>
  wgslBlock(
    `HOLDOUT_ADD_${group}_${binding}_WGSL`,
    [],
    `
@group(${group}) @binding(${binding}) var holdout:texture_storage_2d<${VOLUME_HOLDOUT_FORMAT},read_write>;
fn holdoutAdd(p:vec2i,delta:f32){textureStore(holdout,p,vec4f(textureLoad(holdout,p).x+delta,0.0,0.0,0.0));}`,
  )
