/**
 * Binding numbers of the four WebGPU-path layouts, the single source of truth: the layout
 * itself, the WGSL that declares its variables and the entry list of its constructor all read
 * them here. A binding added to an atlas therefore shifts the numbers on all three sides at
 * once, never on one alone — the defect merging lots 1 and 2 cost.
 */
/** Two bindings of a virtual-texture atlas: its pool and its page table. */
const atlas = (pool: number) => ({ pool, pages: pool + 1 });

/** Two binding shapes the layouts repeat, written once and for all. */
export const readOnly: GPUBufferBindingLayout = { type: 'read-only-storage' };
export const atlasLayoutEntries = (
  bindings: { pool: number; pages: number },
  visibility = GPUShaderStage.FRAGMENT,
): GPUBindGroupLayoutEntry[] => [
  {
    binding: bindings.pool,
    visibility,
    texture: { sampleType: 'float', viewDimension: '2d-array' },
  },
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
  sampler: 8,
  instances: 9,
  slotOffsets: 10,
};

export const SHADE_BINDINGS = {
  visView: 0,
  cache: 1,
  position: 2,
  uv: 3,
  normal: 4,
  pageTable: 5,
  color: atlas(6),
  sampler: 8,
  uniform: 9,
  data: atlas(10),
};

export const BLEND_BINDINGS = {
  indices: 0,
  positions: 1,
  uvs: 2,
  uniform: 3,
  color: atlas(4),
  sampler: 6,
  data: atlas(7),
  normals: 9,
  /** Declared contract lights, the very ones the opaque resolve rereads (P6). */
  directLights: 10,
  clusterDiagnostic: 11,
  /** Instance list the plan expansion wrote: two words per instance, the item that carries it
   *  and what it draws (`webgpuBlendExpandWgsl.ts`). */
  planInstances: 12,
  clusterSpans: 13,
  /** Shadow slices, their atlas and the comparison sampler that reads them. */
  shadowSlices: 14,
  shadowAtlas: 15,
  shadowSampler: 16,
  /** Probe grid and their coefficients: the opaque irradiance, with no extra pass. */
  bounceGrid: 17,
  probes: 18,
  /** Per-tile light lists, the very ones the opaque resolve reads: the blend pass reads its own
   *  depth slice there, from the near plane to the opaque background. */
  tileLights: 19,
  /** Resident proxy, the very one the opaque resolve traces: the sun shadow beyond the last
   *  cascade is taken here by the same ray, on a single binding. */
  proxy: 20,
  /** Parameters of each transparent item, indexed by its rank in the scene: world matrix, colour,
   *  the six maps and their factors. They do not depend on the frame, so a draw no longer has a
   *  dynamic offset or a bind group of its own. */
  items: 21,
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
  sampler: 8,
  work: 9,
  selectionMask: 10,
};
