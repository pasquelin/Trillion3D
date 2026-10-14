/** The formats of the frame's targets beside the surfaces (`./surfaceBuffer.ts`), and the HDR
 *  target's shape and descriptor: no shader text, so the core's byte rules read them without the
 *  renderer's. */
import { mipLevelCountFor } from '../texture/tiles.ts'

/** The HDR colour: what the lighting writes, and the transparents, the effects and the temporal
 *  antialiasing read and write. */
export const HDR_FORMAT: GPUTextureFormat = 'rgba16float'
/** The HDR colour's usages: drawn into, sampled, copied from (the water's backdrop) and into (the
 *  proofs that lay a lit image). Both HDR targets that take turns have them
 *  (`../reflections/radiance.ts`). A function: `GPUTextureUsage` exists only beside a device. */
const hdrUsage = () =>
  GPUTextureUsage.RENDER_ATTACHMENT |
  GPUTextureUsage.TEXTURE_BINDING |
  GPUTextureUsage.COPY_SRC |
  GPUTextureUsage.COPY_DST
/** The scene's depth: every opaque raster's, and every copy made of it. */
export const DEPTH_FORMAT: GPUTextureFormat = 'depth32float'
/** Display colour target, what the composition writes; before it, the water pass borrows it. */
export const DISPLAY_FORMAT: GPUTextureFormat = 'rgba8unorm'
/** Virtual-texture feedback target: the tile rank a pixel asks for, written by hardware
 *  resolve then by transparents, reduced to counters for one pixel in sixteen. */
export const FEEDBACK_FORMAT: GPUTextureFormat = 'r32uint'

/** Levels of the radiance pyramid, level 0 and two a dispatch (`RADIANCE_SHADER`): its coarsest
 *  texel spans 2^(levels − 1) pixels, the widest footprint a reflection reads before it is the
 *  environment's (`reflectionLevelTrust`). */
const RADIANCE_LEVELS = 9
/** The pyramid's levels at `width × height`: an odd count, level 0 and two a dispatch, as many as
 *  the image holds up to `RADIANCE_LEVELS`. */
export const radianceLevels = (width: number, height: number) => {
  const levels = Math.min(RADIANCE_LEVELS, mipLevelCountFor(width, height))
  return levels - ((levels + 1) % 2)
}

/** What an HDR target of `width × height` holds, its usage aside (`hdrTargetDescriptor`). */
export const hdrTargetShape = (width: number, height: number) => ({
  size: [width, height],
  format: HDR_FORMAT,
  mipLevelCount: radianceLevels(width, height),
})

/**
 * One of the two HDR targets of a view at `width × height` that take turns (`adoptRadianceImage`):
 * the lit image at its level 0, the radiance pyramid's levels after it as its mips, which the build
 * writes from the image it holds (`RADIANCE_SHADER`). The pyramid lies in the image it filters: one
 * texture a reader binds for all its levels (`reflectionImage`), none beside it.
 */
export const hdrTargetDescriptor = (width: number, height: number): GPUTextureDescriptor => ({
  label: 'Trillion3D HDR lighting',
  ...hdrTargetShape(width, height),
  usage: hdrUsage() | GPUTextureUsage.STORAGE_BINDING,
})

/** The view a pass draws an HDR target through (`hdrTargetDescriptor`): its level 0 alone. */
export const hdrAttachmentView = (texture: GPUTexture) => texture.createView({ mipLevelCount: 1 })
