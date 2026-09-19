import type { WebgpuTileStreamer } from './webgpuTileStreamer.ts';

/** What a frame gives the compute raster: every one of these resources outlives it. */
export type GpuRasterInput = {
  indices: GPUBuffer;
  positions: GPUBuffer;
  pages: GPUBuffer;
  /** Verdict per row: 0 occluder, 1 tested and rejected, 2 tested and kept. */
  hizFlags: GPUBuffer;
  uniform: GPUBuffer;
  uvs: GPUBuffer;
  textures: WebgpuTileStreamer;
  sampler: GPUSampler;
  pageRows: number;
  maxTriangles: number;
  idsView: GPUTextureView;
  depthView: GPUTextureView;
  hizView?: GPUTextureView;
  /** True when the frame has a tested half: occluder depth is then merged before the
   *  pyramid, into level zero and the buffer. */
  tested: boolean;
  selection?: { maskBuffer: GPUBuffer; maskOffset: number };
  groups: Array<unknown>;
  groupKey: number;
};
