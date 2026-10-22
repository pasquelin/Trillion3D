import type { WebgpuTileStreamer } from '../../materials/virtual/streamer/streamer.ts'
import type { TessellationInput } from '../tessellation/input.ts'

/** What a frame gives the raster: every one of these resources outlives it. */
export type GpuRasterInput = {
  indices: GPUBuffer
  positions: GPUBuffer
  pages: GPUBuffer
  uniform: GPUBuffer
  /** The byte offset of the visibility uniform's post-pass entry, the post binning's: its
   *  selection offset is the post mask's (`../passes/uniforms.ts`). */
  postUniformOffset: number
  uvs: GPUBuffer
  textures: WebgpuTileStreamer
  sampler: GPUSampler
  /** The surfaces' records (`../../materials/table/materialTable.ts`): a row's cutout and shape. */
  material: GPUTextureView
  /** The float pool's normal atlas: a float geometry's second UV set (`pageMaskUv`). */
  normals: GPUTextureView
  /** The compaction's draw records, whose `raster` word the split writes (`binWgsl.ts`). */
  items: GPUBuffer
  /** The drawable rows: one binning workgroup each. */
  pageRows: number
  idsView: GPUTextureView
  depthView: GPUTextureView
  /** Level zero of the Hi-Z pyramid. */
  hizView: GPUTextureView
  /** The cut's masks, whose offsets the uniform entries hold: none, and every row is drawn by the
   *  main pass. */
  selection?: { maskBuffer: GPUBuffer }
  /** Where the image tessellates its displaced surfaces (`../tessellation/wanted.ts`): the view's
   *  numbers and the records. Absent, the image tessellates nothing and the raster allocates and
   *  encodes nothing for it. */
  tessellation?: TessellationInput
  /** The image draws no tessellation yet leaves the displaced surfaces' rows out of its lists (the
   *  primed depth: rough surfaces are not its occluders). Ignored where `tessellation` stands. */
  leaveTessellated?: boolean
}
