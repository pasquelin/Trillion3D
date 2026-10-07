import { POOL_LANES } from '../../texture/blockFormats.ts'

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
})
export type AtlasBindings = ReturnType<typeof atlas>

/** Two binding shapes the layouts repeat, written once and for all. */
export const readOnly: GPUBufferBindingLayout = { type: 'read-only-storage' }
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
]
/** Bytes of the visibility-buffer uniform `Uniforms` (`../../visibility/shader/pageWgsl.ts`): its
 *  nine words after the matrix, rounded up to the struct's 16-byte alignment. */
export const VIS_UNIFORM_BYTES = 112
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
}

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
  subsurface: 17,
  /** The shadow receiver target the resolve writes (`receiverTargetWgsl.ts`). */
  receiver: 18,
  /** What the frame's compute passes composed for the resolve (`shadeCacheWgsl.ts`). */
  shadeCache: 19,
  /** The surfaces' anisotropic and clear-coat records (`../visibility/physicalTable.ts`). */
  physical: 20,
  /** The lobes target the resolve writes and the lighting reads (`../../scene/physicalLobes.ts`). */
  lobes: 21,
}

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
  /** The virtual shadow maps' page table, projection data and uniforms (`BLEND_VSM_BINDINGS`). */
  shadowData: 18,
  shadowAtlas: 19,
  shadowSampler: 20,
  /** Probe grid and their coefficients: the opaque irradiance, with no extra pass. */
  bounceGrid: 21,
  probes: 22,
  /** Per-tile light lists, the very ones the opaque resolve reads: the blend pass reads its own
   *  depth slice there, from the near plane to the opaque background. */
  tileLights: 23,
  /** Resident proxy, the very one the opaque resolve binds, on a single binding. */
  proxy: 24,
  /** Parameters of each transparent item, indexed by its rank in the scene: world matrix, colour,
   *  the six maps and their factors. They do not depend on the frame, so a draw has no
   *  dynamic offset or a bind group of its own. */
  items: 25,
  /** The translucent casters' transmission atlas, then the virtual shadow maps' pool
   *  (`BLEND_VSM_BINDINGS`). */
  shadowTransmittance: 26,
  shadowTranslucentDepth: 27,
  /** Shared outgoing radiance of proxy faces, read by mirror reflections. */
  surfaceCache: 28,
  /** The surfaces' anisotropic and clear-coat records, the opaque resolve's own table
   *  (`../visibility/physicalTable.ts`), read by the lobed programs (`../blend/physicalWgsl.ts`). */
  physical: 29,
}

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
}

/** The virtual shadow maps a transparent samples (`vsmConsumerWgsl`): on the records', atlas,
 *  sampler and translucent depth numbers. */
export const BLEND_VSM_BINDINGS = {
  pageTable: BLEND_BINDINGS.shadowData,
  projectionData: BLEND_BINDINGS.shadowAtlas,
  uniforms: BLEND_BINDINGS.shadowSampler,
  pool: BLEND_BINDINGS.shadowTranslucentDepth,
}
