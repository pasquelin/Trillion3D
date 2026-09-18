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
  /** Vrai quand l'image a une moitié testée : la profondeur des occulteurs se fond alors avant la
   *  pyramide, dans le niveau zéro et le tampon. */
  tested: boolean;
  selection?: { maskBuffer: GPUBuffer; maskOffset: number };
  groups: Array<unknown>;
  groupKey: number;
};
