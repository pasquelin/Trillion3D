/** The formats of the frame's targets beside the surfaces (`./surfaceBuffer.ts`): constants only,
 *  importing nothing, so the core's byte rules read them without the renderer's shader text. */

/** The HDR colour: what the lighting writes, and the transparents, the effects and the temporal
 *  antialiasing read and write. */
export const HDR_FORMAT: GPUTextureFormat = 'rgba16float'
/** The HDR colour's usages: drawn into, sampled, copied from (the water's backdrop) and into (the
 *  proofs that lay a lit image). Both HDR targets that take turns have them
 *  (`../reflections/radiance.ts`). A function: `GPUTextureUsage` exists only beside a device. */
export const hdrUsage = () =>
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
