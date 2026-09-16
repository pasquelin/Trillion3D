import type { WebgpuAtlas } from './webgpuAtlasCommon.ts';
import type { WebgpuAtlasSlots } from './webgpuAtlasSlots.ts';

/** Ce qu'une image donne au raster de calcul : toutes ces ressources lui survivent. */
export type GpuRasterInput = {
  indices: GPUBuffer;
  positions: GPUBuffer;
  pages: GPUBuffer;
  /** Le verdict de chaque ligne : 0 occulteur, 1 testée et rejetée, 2 testée et gardée. */
  hizFlags: GPUBuffer;
  uniform: GPUBuffer;
  uvs: GPUBuffer;
  colorAtlas: WebgpuAtlas;
  slots: WebgpuAtlasSlots;
  sampler: GPUSampler;
  pageRows: number;
  maxTriangles: number;
  idsView: GPUTextureView;
  depthView: GPUTextureView;
  hizView?: GPUTextureView;
  selection?: { maskBuffer: GPUBuffer; maskOffset: number };
  /** La variante de diagnostic qui pèse les occulteurs seuls : la moitié testée reste hors image. */
  skipRest?: boolean;
  groups: Array<unknown>;
  groupKey: number;
};
