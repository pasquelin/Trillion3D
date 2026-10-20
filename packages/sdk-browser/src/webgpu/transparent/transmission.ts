import type { TransmissionBackdrop, WebgpuGpuState } from '../pages/state/gpu.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { DISTORTION_BYTES_PER_PIXEL } from './distortionBytes.ts'
import { DISTORTION_FORMAT, HDR_FORMAT } from '../../scene/targetFormats.ts'

/** Whether the session's targets hold the distortion's: a refracting item is in the plan
 *  (`refracts`), or a source that brings one waits for them (`blendState.refractGranted`). A
 *  transmissive surface that bends nothing needs none. */
export const holdsRefraction = ({ blendState }: Pick<WebgpuPagesRuntime, 'blendState'>) =>
  blendState.refracts || blendState.refractGranted

/** What the distortion adds to the image budget, zero with no refracting surface. */
export function backdropBytes(rt: WebgpuPagesRuntime, width: number, height: number) {
  return holdsRefraction(rt) ? width * height * DISTORTION_BYTES_PER_PIXEL : 0
}

/**
 * Allocates what the distortion owns: the offsets every refracting surface accumulates (a
 * half-float target, enough precision for sub-pixel offsets), and the copy of the opaque scene its
 * application rereads. With no refracting surface they are one texel: the bind layouts are the same for the
 * whole scene, and nothing is reserved for a class the scene does not carry.
 */
export function createBackdrop(
  device: GPUDevice,
  width: number,
  height: number,
  active: boolean,
): TransmissionBackdrop {
  const size = { width: active ? width : 1, height: active ? height : 1 }
  // The scene colour is copied from the HDR target (`../blend/distortion.ts`) and read by the
  // application; the offsets are drawn by the accumulation and read by it too.
  const color = device.createTexture({
    label: 'Trillion3D distortion scene color',
    size,
    format: HDR_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  const distortion = device.createTexture({
    label: 'Trillion3D distortion offsets',
    size,
    format: DISTORTION_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  })
  return {
    color,
    colorView: color.createView(),
    distortion,
    distortionView: distortion.createView(),
    active,
  }
}

export function disposeBackdrop(gpu: WebgpuGpuState) {
  const backdrop = gpu.backdrop
  if (!backdrop) return
  backdrop.color.destroy()
  backdrop.distortion.destroy()
  gpu.backdrop = undefined
}
