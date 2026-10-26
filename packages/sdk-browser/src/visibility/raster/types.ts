import type { WebgpuTileStreamer } from '../../materials/virtual/streamer/streamer.ts'
import type { TessellationInput } from '../tessellation/input.ts'

/** What a frame gives the raster: every one of these resources outlives it. */
export type GpuRasterInput = {
  indices: GPUBuffer
  positions: GPUBuffer
  pages: GPUBuffer
  uniform: GPUBuffer
  uvs: GPUBuffer
  textures: WebgpuTileStreamer
  sampler: GPUSampler
  /** The surfaces' records (`../../materials/table/materialTable.ts`): a row's cutout and shape. */
  material: GPUTextureView
  /** The float pool's normal atlas: a float geometry's second UV set (`pageMaskUv`). */
  normals: GPUTextureView
  /** The graph frame (`../../frame/render/graphFrame.ts`) and the blue noise a dithered cutout is cut
   *  by (or its neutral stand-in): what the cutout and the offsets read of the image. */
  frame: GPUBuffer
  noise: GPUTextureView
  idsView: GPUTextureView
  /** The shading bins' head (`../../materials/classes/shadeBins.ts`): the class word the export
   *  writes each pixel's shading mask from. */
  classBins: GPUTextureView
  depthView: GPUTextureView
  /** Level zero of the Hi-Z pyramid. */
  hizView: GPUTextureView
  /** Where the image tessellates its displaced surfaces (`../tessellation/wanted.ts`): the view's
   *  numbers and the records. Absent, the image tessellates nothing and the raster allocates and
   *  encodes nothing for it. */
  tessellation?: TessellationInput
}
