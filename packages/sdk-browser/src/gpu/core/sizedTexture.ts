import { retire } from './frameRetire.ts'

/** A texture kept for a size, with its view. */
export interface SizedTexture {
  readonly size: readonly [number, number]
  readonly texture: GPUTexture
  readonly view: GPUTextureView
}

/** What a sized texture is made of: its label, format and usage. */
export interface SizedTextureSpec {
  label: string
  format: GPUTextureFormat
  usage: GPUTextureUsageFlags
}

/**
 * The texture kept for `size`: `held` where it is for that size, else made again with `extent` texels (the size by default) and the old one retired (the image being encoded may still
 * name it). None where `extent` passes the device's texture edge: the old one is given back all the same.
 */
export function sizedTexture(
  device: GPUDevice,
  held: SizedTexture | undefined,
  size: readonly [number, number],
  spec: SizedTextureSpec,
  extent: readonly [number, number] = size,
): SizedTexture | undefined {
  if (held?.size[0] === size[0] && held.size[1] === size[1]) return held
  if (held) retire(device, held.texture)
  const limit = device.limits.maxTextureDimension2D
  if (extent[0] > limit || extent[1] > limit) return undefined
  const texture = device.createTexture({ ...spec, size: [extent[0], extent[1]] })
  return { size, texture, view: texture.createView() }
}

/** The texture given back, retired; none to hold in its place. */
export function releaseSized(device: GPUDevice, held: SizedTexture | undefined): undefined {
  if (held) retire(device, held.texture)
  return undefined
}
