/**
 * WHAT THE DEBUG VIEWS KEEP OF THE SAMPLED LIGHTING between the pass that lights the image and the pass that draws over it: the last samples it left, and the texture the spatial
 * filter writes the views' values into. Free of the lighting's own frame code, which imports this.
 */
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

interface PixelsTexture {
  readonly size: readonly [number, number]
  readonly texture: GPUTexture
  readonly view: GPUTextureView
}
const pixels = new WeakMap<WebgpuPagesRuntime, PixelsTexture>()

/** The texture of the spatial filter's debug output for a view of `width` by `height` pixels, made or made again at that size. */
export function debugPixelsTexture(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  width: number,
  height: number,
) {
  const held = pixels.get(rt)
  if (held?.size[0] === width && held.size[1] === height) return held.view
  held?.texture.destroy()
  const texture = device.createTexture({
    label: 'Trillion3D sampled debug pixels',
    size: [Math.max(1, width * DEBUG_PIXEL_BLOCK), Math.max(1, height * DEBUG_PIXEL_BLOCK)],
    format: 'rgba32float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  const made = { size: [width, height] as const, texture, view: texture.createView() }
  pixels.set(rt, made)
  return made.view
}

/** Gives the debug texture of `rt` back. */
export function releaseDebugPixels(rt: WebgpuPagesRuntime) {
  pixels.get(rt)?.texture.destroy()
  pixels.delete(rt)
}

/** The debug texture of `rt`, none while no view made it. */
export const debugPixelsOf = (rt: WebgpuPagesRuntime) => pixels.get(rt)?.view
