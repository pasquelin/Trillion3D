/**
 * WHAT THE DEBUG VIEWS KEEP OF THE SAMPLED LIGHTING between the pass that lights the image and the pass that draws over it: the last samples it left, and the texture the spatial
 * filter writes the views' values into. Free of the lighting's own frame code, which imports this.
 */
import { sizedTexture, type SizedTexture } from '../../../gpu/core/sizedTexture.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import type { SampledSamples } from '../sampledLights.ts'
import { DEBUG_PIXEL_BLOCK } from '../spatialDebugWgsl.ts'

const samplesOf = new WeakMap<WebgpuPagesRuntime, { frame: number; samples: SampledSamples }>()

/** Notes the samples the image `frame` of `rt` was lit with. */
export const rememberSampled = (rt: WebgpuPagesRuntime, frame: number, samples: SampledSamples) =>
  samplesOf.set(rt, { frame, samples })

/** The samples the image `frame` of `rt` was lit with, none if it was lit with none. */
export const sampledOfFrame = (rt: WebgpuPagesRuntime, frame: number) => {
  const held = samplesOf.get(rt)
  return held?.frame === frame ? held.samples : undefined
}

const pixels = new WeakMap<WebgpuPagesRuntime, SizedTexture>()

/** The size of the debug texture of a view of `width` by `height` pixels (a block of `DEBUG_PIXEL_BLOCK` texels each way a pixel), none where it would pass the `limit` of a texture's edge. */
export function debugPixelsSize(width: number, height: number, limit: number) {
  const size = [
    Math.max(1, width * DEBUG_PIXEL_BLOCK),
    Math.max(1, height * DEBUG_PIXEL_BLOCK),
  ] as const
  return size[0] <= limit && size[1] <= limit ? size : undefined
}

/**
 * The texture of the spatial filter's debug output for a view of `width` by `height` pixels, made or made again at that size. None where the view is too wide for the device to hold it: the
 * filter is then the plain one and the denoiser's views show nothing, rather than a texture the device refuses.
 */
export function debugPixelsTexture(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  width: number,
  height: number,
) {
  const extent = debugPixelsSize(width, height, device.limits.maxTextureDimension2D)
  if (!extent) return (releaseDebugPixels(rt), undefined)
  const made = sizedTexture(
    device,
    pixels.get(rt),
    [width, height],
    {
      label: 'Trillion3D sampled debug pixels',
      format: 'rgba32float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    },
    extent,
  )
  if (made) pixels.set(rt, made)
  else pixels.delete(rt)
  return made?.view
}

/** Gives the debug texture of `rt` back. */
export function releaseDebugPixels(rt: WebgpuPagesRuntime) {
  pixels.get(rt)?.texture.destroy()
  pixels.delete(rt)
}

/** The debug texture of `rt`, none while no view made it. */
export const debugPixelsOf = (rt: WebgpuPagesRuntime) => pixels.get(rt)?.view
