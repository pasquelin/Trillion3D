import { POOL_LANES } from '../../texture/blockFormats.ts';

/**
 * Binding numbers of the four WebGPU-path layouts, the single source of truth: the layout
 * itself, the WGSL that declares its variables and the entry list of its constructor all read
 * them here. A binding added to an atlas therefore shifts the numbers on all three sides at
 * once, never on one alone — the defect merging lots 1 and 2 cost.
 */

/** Four bindings of a virtual-texture atlas: one pool per lane, in `POOL_LANES` order, then its
 *  page table. */
const atlas = (base: number) => ({
  lanes: POOL_LANES.map((_, index) => base + index),
  pages: base + POOL_LANES.length,
});
export type AtlasBindings = ReturnType<typeof atlas>;

/** Two binding shapes the layouts repeat, written once and for all. */
export const readOnly: GPUBufferBindingLayout = { type: 'read-only-storage' };
export const atlasLayoutEntries = (
  bindings: AtlasBindings,
  visibility = GPUShaderStage.FRAGMENT,
): GPUBindGroupLayoutEntry[] => [
  ...bindings.lanes.map((binding) => ({
    binding,
    visibility,
    texture: { sampleType: 'float', viewDimension: '2d-array' } as GPUTextureBindingLayout,
  })),
  { binding: bindings.pages, visibility, buffer: readOnly },
];
export const VIS_BINDINGS = {
  cache: 0,
  position: 1,
  pageTable: 2,
  flags: 3,
  uniform: 4,
  uv: 5,
  color: atlas(6),
  sampler: 10,
  instances: 11,
  slotOffsets: 12,
};

export const SHADE_BINDINGS = {
  visView: 0,
  cache: 1,
  position: 2,
  uv: 3,
  normal: 4,
  pageTable: 5,
  color: atlas(6),
  sampler: 10,
  uniform: 11,
  data: atlas(12),
};

export const BLEND_BINDINGS = {
  indices: 0,
  positions: 1,
  uvs: 2,
  uniform: 3,
  color: atlas(4),
  sampler: 8,
  data: atlas(9),
  normals: 13,
  /** Declared contract lights, the very ones the opaque resolve rereads (P6). */
  directLights: 14,
  clusterDiagnostic: 15,
  /** Instance list the plan expansion wrote: two words per instance, the item that carries it
   *  and what it draws (`../blend/expandWgsl.ts`). */
  planInstances: 16,
  clusterSpans: 17,
  /** Shadow slices, their atlas and the comparison sampler that reads them. */
  shadowSlices: 18,
  shadowAtlas: 19,
  shadowSampler: 20,
  /** Probe grid and their coefficients: the opaque irradiance, with no extra pass. */
  bounceGrid: 21,
  probes: 22,
  /** Per-tile light lists, the very ones the opaque resolve reads: the blend pass reads its own
   *  depth slice there, from the near plane to the opaque background. */
  tileLights: 23,
  /** Resident proxy, the very one the opaque resolve traces: the sun shadow beyond the last
   *  cascade is taken here by the same ray, on a single binding. */
  proxy: 24,
  /** Parameters of each transparent item, indexed by its rank in the scene: world matrix, colour,
   *  the six maps and their factors. They do not depend on the frame, so a draw no longer has a
   *  dynamic offset or a bind group of its own. */
  items: 25,
};

/**
 * The software raster lives entirely in the compute stage, where WebGPU guarantees only eight
 * storage buffers: the image and the small-triangle list therefore share one buffer, `work`,
 * the image first and the list right after it. One binding less, and the count holds.
 */
export const SMALL_BINDINGS = {
  indices: 0,
  positions: 1,
  pages: 2,
  hizFlags: 3,
  uniform: 4,
  uvs: 5,
  color: atlas(6),
  sampler: 10,
  work: 11,
  selectionMask: 12,
};
