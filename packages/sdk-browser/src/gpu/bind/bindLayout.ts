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

/** The bindings of a virtual-texture atlas: one pool per lane, in `PREVIEW_LAYOUT_NAMES` order, then
 *  its page table. */
export interface AtlasBindings {
  readonly lanes: readonly number[]
  readonly pages: number
}

/** Four bindings of a virtual-texture atlas from `base`. */
const atlasBindings = (base: number): AtlasBindings => ({
  lanes: PREVIEW_LAYOUT_NAMES.map((_, index) => base + index),
  pages: base + PREVIEW_LAYOUT_NAMES.length,
})

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
   *  what a row's cutout reads its base map at (`pageMaskUv`), in every raster. */
  normals: 14,
  /** The graph frame (`../../visibility/shader/graphFrameWgsl.ts`): the clocks and the camera of the
   *  image, which a cutout and an offset read; seen by every stage that cuts or places a vertex. */
  frame: 15,
  /** The engine's blue noise, read by load (`../noise/blueNoiseWgsl.ts`, `loadOnly`): what a dithered
   *  cutout is cut by in a fragment stage or the software raster (`maskDitherWgsl`). */
  noise: 16,
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
  /** The surfaces' records (`../../materials/table/materialTable.ts`). */
  material: 20,
  /** The lobes target the resolve writes and the lighting reads (`../../materials/surface/physicalLobes.ts`). */
  lobes: 21,
  /** The voxel trace's counters, which the voxel classes alone write (`voxelStepsWgsl.ts`). */
  voxelSteps: 22,
  /** The graph frame (`VIS_BINDINGS.frame`), which an offset places a vertex by. */
  frame: 23,
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
  /** Instance list the plan expansion wrote: two words per instance, the item that carries it
   *  and what it draws (`../../blend/expand/expandWgsl.ts`). */
  planInstances: 16,
  /** Each cluster's span in the cache (four words), then, after the spans, the cluster's identity word the diagnostic
   *  views colour it by: one buffer, the vertex stage's eighth and last storage buffer with the lists of the local fog
   *  volumes (`fogTiles`). */
  clusterSpans: 17,
  /** The virtual shadow maps' page table, projection data and uniforms (`BLEND_VSM_BINDINGS`). */
  shadowData: 18,
  shadowAtlas: 19,
  shadowSampler: 20,
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
  /** The virtual shadow maps' pool (`BLEND_VSM_BINDINGS`). */
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
  /** What the light functions are read from (`BLEND_LIGHT_FUNCTION_BINDINGS`): the atlas and its
   *  table, one texture of words read by load — a read-only storage texture, as the other load-only
   *  targets: the stage's third storage texture. */
  lightFunctionAtlas: 34,
  /** The lists of the local fog volumes over each tile of the view (`BLEND_FOG_BINDINGS`,
   *  `fogTilesWgsl`, `../../lighting/fog/localWgsl.ts`): a read-only storage buffer of words, the fragment stage's
   *  eighth and last of the eight WebGPU guarantees, and read by the vertex stage too (which holds eight). Past the three of the clouds' shade
   *  (`BLEND_CLOUD_SHADE_BINDINGS`) that follow the light functions'. */
  fogTiles: 38,
  /** The graph frame (`VIS_BINDINGS.frame`), past the clouds' image (`BLEND_CLOUD_FOG_BINDINGS`). */
  frame: 46,
  /** The translucency lighting volume the surfaces lit from it read (`../../lighting/translucency/readWgsl.ts`): one sampled 3D
   *  texture of half floats, the ambient and the directional light of its two cascades stacked along the depth, read through the
   *  trilinear sampler of the translucency global illumination volume (`translucencyGiSampler`). It takes the sampled textures the
   *  forward programs' reflection group no longer binds (`reflectionForwardLayout`: the depth pyramid's two and the lit image). */
  translucencyVolume: 47,
  /** The translucency global illumination volume the see-through surfaces read their indirect light from
   *  (`../../lighting/translucencyGi/readWgsl.ts`): one sampled 3D texture, the ambient light and the directional light, signed, stacked in its
   *  depth (`rgba16float`, single floats where the lighting data format is), and the trilinear sampler it is read through. It takes the sampled
   *  texture the world's probes' atlas held, which a surface no longer gathers. */
  translucencyGi: 21,
  translucencyGiSampler: 22,
  /** The light profiles' atlas, a sampled 2D array of half floats, and the sampler it is read through (`BLEND_LIGHT_PROFILE_BINDINGS`): the
   *  sampled texture slot the stacked volume freed, and the next sampler past the opaque flags' binding. */
  lightProfileAtlas: 26,
  lightProfileSampler: 49,
  /** The opaque surfaces' flags, read by load at the surface a contact shadow ray hits (`blend/contactSceneWgsl.ts`): the
   *  fourth and last storage texture of the fragment stage. They lie in the surfaces' word target (`SURFACE_OUTPUTS`), which
   *  no other texture the stage binds holds: the slot stays. */
  surfaceFlags: 48,
  /** The beer map of the camera and the radiance the volumes composited with the translucency lay (`../../lighting/heterogeneousVolumes/cameraMap.ts`): one
   *  sampled 2D array of half floats, in the sampled texture the front depth freed (`FRONT_TRACED_FORMAT` carries it). */
  volumeCamera: 50,
}

/**
 * The software raster lives entirely in the compute stage, where WebGPU guarantees only eight
 * storage buffers: it binds seven — the geometry's three and its UVs, the colour atlas's page
 * table, the visibility buffer `work` and the pass's list of clusters `lists`.
 */
export const SMALL_BINDINGS = {
  indices: 0,
  positions: 1,
  pages: 2,
  lists: 3,
  uniform: 4,
  uvs: 5,
  color: atlasBindings(6),
  sampler: 10,
  work: 11,
  /** The visibility raster's number: the one cutout (`maskKeepWgsl`) reads it there in both. */
  material: VIS_BINDINGS.material,
  /** The visibility raster's number: the cutout's coordinate (`pageMaskUv`) reads it there in both. */
  normals: VIS_BINDINGS.normals,
  /** The visibility raster's numbers: the graph frame and the blue noise a cutout reads there in both. */
  frame: VIS_BINDINGS.frame,
  noise: VIS_BINDINGS.noise,
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
 *  group 0, read as a translucent layer reads it (`translucent`): through the sampler alone, the cubic
 *  filters left out. */
export const BLEND_FOG_BINDINGS = {
  group: 0,
  sampler: BLEND_BINDINGS.fogSampler,
  cubemap: BLEND_BINDINGS.fogCubemap,
  volume: BLEND_BINDINGS.fogVolume,
  tiles: BLEND_BINDINGS.fogTiles,
  translucent: true,
}
/** Where a transparent's fragment reads the light functions (`lightFunctionReadWgsl`), in group 0, and
 *  the eye their fade is measured from. */
export const BLEND_LIGHT_FUNCTION_BINDINGS = {
  group: 0,
  atlas: BLEND_BINDINGS.lightFunctionAtlas,
  eye: 'uni.eye',
  storage: true,
}
/** Where a transparent's vertex stage reads the clouds' shade of the forward directional light
 *  (`cloudShadowReadWgsl`, per vertex), in group 0, after the light functions' atlas: the block, the
 *  one map and the sampler it is read through, read by the vertex stage alone, in every layout
 *  (`blendLayoutEntries`), the stand-in that shades nothing bound where no program reads it
 *  (`../../blend/cloudVertex.ts`). */
export const BLEND_CLOUD_SHADE_BINDINGS = {
  group: 0,
  block: BLEND_BINDINGS.lightFunctionAtlas + 1,
  map0: BLEND_BINDINGS.lightFunctionAtlas + 2,
  sampler: BLEND_BINDINGS.lightFunctionAtlas + 3,
  perVertex: true,
} as const
/** Where a transparent's vertex stage reads the clouds for the surfaces whose material has `cloudFog`
 *  (`../../modules/sky/clouds/translucentRead.ts`, per vertex), in group 0, past the fog's lists of
 *  tiles and the clouds' shade: the block, the cloud image's colour and its depth (kilometres in
 *  `x`) and the sampler the colour is read through; read by the vertex stage alone, in every layout
 *  (`blendLayoutEntries`), the stand-in that clears the layer bound where no program reads it
 *  (`../../blend/cloudVertex.ts`). The fragment stage has no room for the image: its sixteen sampled
 *  textures and eight storage buffers are spent. */
export const BLEND_CLOUD_FOG_BINDINGS = {
  group: 0,
  block: BLEND_BINDINGS.lightFunctionAtlas + 8,
  colour: BLEND_BINDINGS.lightFunctionAtlas + 9,
  depth: BLEND_BINDINGS.lightFunctionAtlas + 10,
  sampler: BLEND_BINDINGS.lightFunctionAtlas + 11,
} as const
/** Where a transparent's fragment reads the light profiles (`lightProfileOfWgsl`), in group 0. */
export const BLEND_LIGHT_PROFILE_BINDINGS = {
  group: 0,
  atlas: BLEND_BINDINGS.lightProfileAtlas,
  sampler: BLEND_BINDINGS.lightProfileSampler,
} as const
/** Where a transparent's fragment reads the rectangle lights' pictures (`rectSourceWgsl`), in group 0, past the bindings of the table:
 *  the atlas and its trilinear sampler. They are the seventeenth sampled texture of the widest program's fragment stage, so the
 *  layout holds them only on a device that grants it (`grantsRectPictures`); else a rectangle is plain. */
export const BLEND_RECT_BINDINGS = { atlas: 51, sampler: 52 } as const
/** The profiles' bindings with the rectangle lights' pictures (`BLEND_RECT_BINDINGS`) beside them. */
export const BLEND_LIGHT_PROFILE_RECT_BINDINGS = {
  ...BLEND_LIGHT_PROFILE_BINDINGS,
  rectAtlas: BLEND_RECT_BINDINGS.atlas,
  rectSampler: BLEND_RECT_BINDINGS.sampler,
} as const
/** What a transparent's fragment traces its shadow with (`directShadowWgsl`): the blue noise is a
 *  read-only storage texture, read by load (`loadOnly`). */
export const BLEND_TRACE_BINDINGS = {
  view: BLEND_BINDINGS.shadowView,
  noise: BLEND_BINDINGS.shadowNoise,
  loadOnly: true,
}
