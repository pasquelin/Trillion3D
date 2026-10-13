import { PREVIEW_LAYOUT_NAMES } from '../../../../sdk-core/src/index.ts'
import { VIS_UNIFORM } from '../../visibility/shader/uniformLayout.ts'
import { uniformSlots, uniformStride, type UniformSlots } from '../../residency/pools.ts'
import { computeBufferEntry } from '../../gpu/core/computeBindings.ts'
import { vsmForwardPoolBinding } from '../../vsm/resources.ts'

/**
 * Binding numbers of the four WebGPU-path layouts, the single source of truth: the layout
 * itself, the WGSL that declares its variables and the entry list of its constructor all read
 * them here. A binding added to an atlas therefore shifts the numbers on all three sides at
 * once, never on one alone — the defect merging lots 1 and 2 cost.
 */

/** Four bindings of a virtual-texture atlas: one pool per lane, in `PREVIEW_LAYOUT_NAMES` order, then its
 *  page table. */
const atlas = (base: number) => ({
  lanes: PREVIEW_LAYOUT_NAMES.map((_, index) => base + index),
  pages: base + PREVIEW_LAYOUT_NAMES.length,
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
  computeBufferEntry(bindings.pages, 'read-only-storage', visibility),
]
/** Bytes of the visibility-buffer uniform `Uniforms` (`VIS_UNIFORM`). */
export const VIS_UNIFORM_BYTES = VIS_UNIFORM.words * 4
let visSlots: UniformSlots | undefined
/** The visibility uniform's `count` slots on a device of `limits`: the layout the upload writes
 *  every frame, kept while the count and the alignment hold (nothing allocated a frame). */
export const visUniformLayout = (limits: Parameters<typeof uniformSlots>[0], count: number) =>
  visSlots?.count === count && visSlots.stride === uniformStride(limits)
    ? visSlots
    : (visSlots = uniformSlots(limits, count, VIS_UNIFORM_BYTES / 4))
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
  /** The proxy's buffer, the culling's world matrices mirrored in it, which the reflection of the forward programs traces. */
  proxy: 24,
  /** Parameters of each transparent item, indexed by its rank in the scene: world matrix, colour,
   *  the six maps and their factors. They do not depend on the frame, so a draw has no
   *  dynamic offset or a bind group of its own. */
  items: 25,
  /** The translucent casters' transmission atlas, then the virtual shadow maps' pool
   *  (`BLEND_VSM_BINDINGS`). */
  shadowTransmittance: 26,
  shadowTranslucentDepth: 27,
  /** The surfaces' anisotropic and clear-coat records, the opaque resolve's own table
   *  (`../visibility/physicalTable.ts`), read by the lobed programs (`../blend/physicalWgsl.ts`). */
  physical: 28,
  /** What a fragment traces its shadow with past the maps (`BLEND_TRACE_BINDINGS`): the shadow
   *  projection's view uniform and its blue noise. */
  shadowView: 29,
  shadowNoise: 30,
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
  pool: vsmForwardPoolBinding(BLEND_BINDINGS.shadowTranslucentDepth),
}
/** What a transparent's fragment traces its shadow with (`directShadowWgsl`). */
export const BLEND_TRACE_BINDINGS = {
  view: BLEND_BINDINGS.shadowView,
  noise: BLEND_BINDINGS.shadowNoise,
}
