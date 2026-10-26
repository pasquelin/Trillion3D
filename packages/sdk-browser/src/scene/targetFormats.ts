/** The formats of the frame's targets beside the surfaces (`../materials/surface/surfaceBuffer.ts`), and the HDR
 *  target's descriptor: no shader text, so the core's byte rules read them without the renderer's. */

/** The HDR colour: what the lighting writes, and the transparents, the effects and the temporal
 *  antialiasing read and write; the reflection target the upsample writes holds it at the lit
 *  image's precision (`../lighting/reflections/gpu.ts`). */
export const HDR_FORMAT: GPUTextureFormat = 'rgba16float'
/** The distortion offsets, half floats — enough precision for sub-pixel offsets: positive offsets in red and green, negative in blue and alpha. */
export const DISTORTION_FORMAT: GPUTextureFormat = 'rgba16float'
/** The HDR colour's usages: drawn into, sampled, copied from (the distortion's scene copy) and into (the
 *  proofs that lay a lit image). Both HDR targets that take turns have them
 *  (`../lighting/reflections/litImage.ts`). A function: `GPUTextureUsage` exists only beside a device. */
const hdrUsage = () =>
  GPUTextureUsage.RENDER_ATTACHMENT |
  GPUTextureUsage.TEXTURE_BINDING |
  GPUTextureUsage.COPY_SRC |
  GPUTextureUsage.COPY_DST
/** The scene's depth: every opaque raster's, and every copy made of it. */
export const DEPTH_FORMAT: GPUTextureFormat = 'depth32float'
/** Display colour target, what the composition writes. */
export const DISPLAY_FORMAT: GPUTextureFormat = 'rgba8unorm'
/** Virtual-texture feedback target: the tile rank a pixel asks for, written by hardware
 *  resolve then by transparents, reduced to counters for one pixel in 256. */
export const FEEDBACK_FORMAT: GPUTextureFormat = 'r32uint'

/**
 * One of the two HDR targets of a view at `width × height` that take turns (`adoptLitImage`): the lit
 * image, one level. The one the last image lit is read as it is by the next image's reflections
 * (`reflectionImage`).
 */
export const hdrTargetDescriptor = (width: number, height: number): GPUTextureDescriptor => ({
  label: 'Trillion3D HDR lighting',
  size: [width, height],
  format: HDR_FORMAT,
  usage: hdrUsage(),
})
