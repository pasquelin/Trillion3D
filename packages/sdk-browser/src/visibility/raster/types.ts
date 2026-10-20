import type { WebgpuTileStreamer } from '../../materials/virtual/streamer/streamer.ts'

/** What a frame gives the compute raster: every one of these resources outlives it. */
export type GpuRasterInput = {
  indices: GPUBuffer
  positions: GPUBuffer
  pages: GPUBuffer
  /** Verdict per row: 0 occluder, 1 tested and rejected, 2 tested and kept. */
  hizFlags: GPUBuffer
  uniform: GPUBuffer
  uvs: GPUBuffer
  textures: WebgpuTileStreamer
  sampler: GPUSampler
  /** The surfaces' records (`../../materials/table/materialTable.ts`): a row's cutout and shape. */
  material: GPUTextureView
  /** The float pool's normal atlas: a float geometry's second UV set (`pageMaskUv`). */
  normals: GPUTextureView
  pageRows: number
  maxTriangles: number
  idsView: GPUTextureView
  depthView: GPUTextureView
  hizView?: GPUTextureView
  /** True when the frame has a tested half: occluder depth is then merged before the
   *  pyramid, into level zero and the buffer. */
  tested: boolean
  selection?: { maskBuffer: GPUBuffer; maskOffset: number }
  groups: Array<unknown>
  groupKey: number
}
