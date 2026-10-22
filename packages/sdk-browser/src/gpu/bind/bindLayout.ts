import { PREVIEW_LAYOUT_NAMES } from '../../../../sdk-core/src/texture/previewFormat.ts'
import { VIS_UNIFORM } from '../../visibility/shader/uniformLayout.ts'
import { uniformSlots, uniformStride, type UniformSlots } from '../../session/memory/pools.ts'
import { computeBufferEntry, computeTextureEntry } from '../core/computeBindings.ts'

/**
 * Binding numbers of the four WebGPU-path layouts, the single source of truth: the layout
 * itself, the WGSL that declares its variables and the entry list of its constructor all read
 * them here. A binding added to an atlas therefore shifts the numbers on all three sides at
 * once, never on one alone — the defect merging lots 1 and 2 cost.
 */

/** Four bindings of a virtual-texture atlas from `base`: one pool per lane, in
 *  `PREVIEW_LAYOUT_NAMES` order, then its page table. */
const atlasBindings = (base: number) => ({
  lanes: PREVIEW_LAYOUT_NAMES.map((_, index) => base + index),
  pages: base + PREVIEW_LAYOUT_NAMES.length,
})
export type AtlasBindings = ReturnType<typeof atlasBindings>

/** The layout entries of an atlas's lanes and page table, seen by `visibility`. */
export const atlasLayoutEntries = (
  bindings: AtlasBindings,
  visibility = GPUShaderStage.FRAGMENT,
): GPUBindGroupLayoutEntry[] => [
  ...bindings.lanes.map((binding) => computeTextureEntry(binding, 'float', '2d-array', visibility)),
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
/** The visibility uniform of `count` slots on `device` (`visUniformLayout`). */
export const visUniformBuffer = (device: GPUDevice, count: number) =>
  device.createBuffer({
    label: 'Trillion3D visibility uniforms',
    size: visUniformLayout(device.limits, count).bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
export const VIS_BINDINGS = {
  cache: 0,
  position: 1,
  pageTable: 2,
  uniform: 4,
  uv: 5,
  color: atlasBindings(6),
  sampler: 10,
  instances: 11,
  slotOffsets: 12,
  /** The surfaces' records (`../../materials/table/materialTable.ts`): a row's cutout and shape. */
  material: 13,
  /** The float pool's normal atlas, whose tail holds a float geometry's second UV set (`vertUv1`):
   *  what a row's cutout reads its base map at (`pageMaskUv`), in every raster and the shadow's
   *  transmittance. */
  normals: 14,
}

export const SHADE_BINDINGS = {
  visView: 0,
  cache: 1,
  position: 2,
  uv: 3,
  normal: 4,
  pageTable: 5,
  color: atlasBindings(6),
  sampler: 10,
  uniform: 11,
  data: atlasBindings(12),
  /** What the frame's compute passes composed for the resolve (`shadeCacheWgsl.ts`). */
  shadeCache: 19,
  /** The surfaces' records (`../../materials/table/materialTable.ts`). */
  material: 20,
  /** The lobes target the resolve writes and the lighting reads (`../../materials/surface/physicalLobes.ts`). */
  lobes: 21,
  /** The voxel trace's counters, which the voxel classes alone write (`voxelStepsWgsl.ts`). */
  voxelSteps: 22,
}

export const BLEND_BINDINGS = {
  indices: 0,
  positions: 1,
  uvs: 2,
  uniform: 3,
  color: atlasBindings(4),
  sampler: 8,
  data: atlasBindings(9),
  normals: 13,
  /** Declared contract lights, the very ones the opaque resolve rereads (P6). */
  directLights: 14,
  clusterDiagnostic: 15,
  /** Instance list the plan expansion wrote: two words per instance, the item that carries it
   *  and what it draws (`../../blend/expand/expandWgsl.ts`). */
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
  /** The transparents' front radiance the reflection trace wrote (`../../lighting/reflections/frontLayer.ts`),
   *  which a fragment of the front surface reads its reflection from. */
  frontTraced: 24,
  /** Parameters of each transparent item, indexed by its rank in the scene: world matrix, colour,
   *  the six maps and their factors. They do not depend on the frame, so a draw has no
   *  dynamic offset or a bind group of its own. */
  items: 25,
  /** The translucent casters' transmission atlas, then the virtual shadow maps' pool
   *  (`BLEND_VSM_BINDINGS`). */
  shadowTransmittance: 26,
  shadowPool: 27,
  /** The surfaces' records, the opaque resolve's own table (`../../materials/table/materialTable.ts`). */
  material: 28,
  /** What a fragment traces its shadow with past the maps (`BLEND_TRACE_BINDINGS`): the shadow
   *  projection's view uniform and its blue noise. */
  shadowView: 29,
  shadowNoise: 30,
  /** What the fog reads past the light buffer (`BLEND_FOG_BINDINGS`): the cubemap, the volume, and
   *  the sampler they are read through. */
  fogCubemap: 31,
  fogVolume: 32,
  fogSampler: 33,
}

/**
 * The software raster lives entirely in the compute stage, where WebGPU guarantees only eight
 * storage buffers: the image and the triangle lists therefore share one buffer, `work`, the
 * image first and the lists right after it. One binding less, and the count holds. Its binning
 * binds a layout of its own (`../../visibility/raster/binWgsl.ts`).
 */
export const SMALL_BINDINGS = {
  indices: 0,
  positions: 1,
  pages: 2,
  uniform: 4,
  uvs: 5,
  color: atlasBindings(6),
  sampler: 10,
  work: 11,
  /** The visibility raster's number: the one cutout (`maskKeepWgsl`) reads it there in both. */
  material: VIS_BINDINGS.material,
  /** The visibility raster's number: the cutout's coordinate (`pageMaskUv`) reads it there in both. */
  normals: VIS_BINDINGS.normals,
}

/** The virtual shadow maps a transparent samples (`vsmConsumerWgsl`): on the records', atlas,
 *  sampler and pool numbers. */
export const BLEND_VSM_BINDINGS = {
  pageTable: BLEND_BINDINGS.shadowData,
  projectionData: BLEND_BINDINGS.shadowAtlas,
  uniforms: BLEND_BINDINGS.shadowSampler,
  pool: BLEND_BINDINGS.shadowPool,
}
/** Where a transparent's fragment reads the fog's cubemap and volume (`fogResourcesWgsl`), in
 *  group 0, the volume through the sampler alone, the cubic filters left out (`trilinear`). */
export const BLEND_FOG_BINDINGS = {
  group: 0,
  sampler: BLEND_BINDINGS.fogSampler,
  cubemap: BLEND_BINDINGS.fogCubemap,
  volume: BLEND_BINDINGS.fogVolume,
  trilinear: true,
}
/** What a transparent's fragment traces its shadow with (`directShadowWgsl`): the blue noise and the
 *  translucent casters' memory are read-only storage textures, read by load (`loadOnly`). */
export const BLEND_TRACE_BINDINGS = {
  view: BLEND_BINDINGS.shadowView,
  noise: BLEND_BINDINGS.shadowNoise,
  loadOnly: true,
}
