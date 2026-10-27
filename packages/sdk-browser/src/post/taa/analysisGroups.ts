import { namedEntries } from '../../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { velocityAtlasBound, velocityInputResources, type TaaInputs } from './inputs.ts'
import type { AnalysisLayouts } from './analysisLayouts.ts'
import type { AnalysisTargetViews } from './analysisTargets.ts'
import type { FrameSlices } from './historyFrames.ts'
import { VELOCITY_BINDINGS } from './nearestVelocityWgsl.ts'
import { REPROJECT_BINDINGS } from './reprojectWgsl.ts'
import { THIN_GEOMETRY_BINDINGS, THIN_RELAXATION_BINDINGS } from './thinGeometryWgsl.ts'
import { REJECT_SHADING_BINDINGS } from './rejectionWgsl.ts'
import { SPATIAL_AA_BINDINGS } from './spatialAntiAliasingWgsl.ts'
import { FUSED_FLATTEN_SLOTS } from '../effects/motionBlur/flattenWgsl.ts'
import type { FusedFlatten } from '../effects/motionBlur/motionBlurLayout.ts'

/** What the analysis reads of the frame (`TaaInputs`), in its groups' identity order; the colour
 *  atlas's bound views and page table after them (`velocityAtlasBound`). */
const ANALYSIS_INPUTS = [
  'current',
  'depth',
  'ids',
  'pages',
  'worlds',
  'previous',
  'vectors',
  'pool',
  'positions',
  'uvs',
  'normals',
  'material',
  'frame',
  'sampler',
  'translucency',
  'responsive',
] as const

/** What a group is made of: the device, the layouts and the uniform and sampler its groups name. */
type Context = {
  device: GPUDevice
  layouts: AnalysisLayouts
  uniform: GPUBuffer
  sampler: GPUSampler
}

/** What the nearest velocity names: the frame's surfaces, the velocity stage's vectors, the
 *  responsiveness of the layers over each pixel and the targets. */
const velocityEntries = ({ uniform }: Context, inputs: TaaInputs, t: AnalysisTargetViews) =>
  namedEntries(VELOCITY_BINDINGS, {
    ...velocityInputResources(inputs, uniform),
    closest: t.closest,
    marks: t.marks,
    occluders: { buffer: t.occluders },
    vectors: inputs.vectors,
    responsive: inputs.responsive!,
    jacobian: t.jacobian,
    boundary: t.boundary,
  })

/** The group of the nearest velocity. */
const velocityGroup = (context: Context, inputs: TaaInputs, t: AnalysisTargetViews) =>
  context.device.createBindGroup({
    layout: context.layouts.velocity,
    entries: velocityEntries(context, inputs, t),
  })

/** The group of the nearest velocity that also flattens the motion blur's motion: the same, and the
 *  blur's uniform, the flattened motion and the tile ranges it writes. */
const fusedVelocityGroup = (
  context: Context,
  inputs: TaaInputs,
  t: AnalysisTargetViews,
  flatten: FusedFlatten,
) =>
  context.device.createBindGroup({
    layout: context.layouts.fusedVelocity(flatten.variant),
    entries: [
      ...velocityEntries(context, inputs, t),
      ...namedEntries(FUSED_FLATTEN_SLOTS, {
        params: { buffer: flatten.params },
        flat: flatten.flat,
        tiles: flatten.tiles,
        ...(flatten.tilesSecond && { tilesSecond: flatten.tilesSecond }),
      }),
    ],
  })

/** The group of the reprojection of the frame `previous`, the frame `resurrection` a pixel may be
 *  resurrected from beside it: the velocity stage's vectors and depth, the targets, and their
 *  shading histories. */
function reprojectGroup(
  { device, layouts, uniform, sampler }: Context,
  inputs: TaaInputs,
  t: AnalysisTargetViews,
  previous: number,
  resurrection: number,
) {
  return device.createBindGroup({
    layout: layouts.reproject,
    entries: namedEntries(REPROJECT_BINDINGS, {
      view: { buffer: uniform },
      marks: t.marks,
      closest: t.closest,
      vectors: inputs.vectors,
      occluders: { buffer: t.occluders },
      prevShading: t.guides[previous],
      historySampler: sampler,
      prevFlicker: t.flicker,
      shading: t.guidesReprojected,
      flicker: t.flickerReprojected,
      word: t.reprojected,
      field: t.field,
      prevThin: t.thinHistory,
      depth: inputs.depth,
      resurrectGuide: t.guides[resurrection],
    }),
  })
}

/** The group of the thin geometry detection. */
const thinGroup = (
  { device, layouts, uniform }: Context,
  inputs: TaaInputs,
  t: AnalysisTargetViews,
) =>
  device.createBindGroup({
    layout: layouts.thin,
    entries: namedEntries(THIN_GEOMETRY_BINDINGS, {
      view: { buffer: uniform },
      depth: inputs.depth,
      luma: t.measureLuma,
      coverage: t.measureCoverage,
      marks: t.marks,
      word: t.reprojected,
      thinOut: t.thin,
    }),
  })

/** The group of the thin geometry's weight relaxation. */
const relaxationGroup = (
  { device, layouts, uniform }: Context,
  inputs: TaaInputs,
  t: AnalysisTargetViews,
) =>
  device.createBindGroup({
    layout: layouts.relaxation,
    entries: namedEntries(THIN_RELAXATION_BINDINGS, {
      view: { buffer: uniform },
      thin: t.thin,
      current: inputs.current,
      translucency: inputs.translucency!,
      maskOut: t.thinMask,
      historyOut: t.thinHistory,
    }),
  })

/** The group of the shading rejection writing the shading history of the frame `current`, with the
 *  flicker history it writes beside the reprojected one it reads. */
function rejectShadingGroup(
  { device, layouts, uniform }: Context,
  inputs: TaaInputs,
  t: AnalysisTargetViews,
  current: number,
) {
  return device.createBindGroup({
    layout: layouts.rejectShading,
    entries: namedEntries(REJECT_SHADING_BINDINGS, {
      view: { buffer: uniform },
      current: inputs.current,
      translucency: inputs.translucency!,
      word: t.reprojected,
      guides: t.guidesReprojected,
      marks: t.marks,
      thin: t.thinMask,
      thinHistory: t.thinHistory,
      depth: inputs.depth,
      guideOut: t.guides[current],
      rejection: t.rejection,
      antiAliasMask: t.antiAliasMask,
      field: t.field,
      occluders: { buffer: t.occluders },
      sceneColor: { buffer: t.sceneColor },
      luma: t.luma,
      flicker: t.flickerReprojected,
      measuredLuma: t.measureLuma,
      flickerOut: t.flicker,
    }),
  })
}

/** What one identity of the inputs holds: the groups that do not depend on the frames' slots, and
 *  those that do — the reprojection's by the frames read, the shading rejection's by the frame
 *  written — as they were made. */
interface HeldGroups {
  groups: GPUBindGroup[]
  reproject: Map<number, GPUBindGroup>
  rejectShading: Map<number, GPUBindGroup>
  /** The nearest velocity's that flattens the blur's motion, by the image it flattens into. */
  fused: Map<
    GPUTextureView,
    {
      params: GPUBuffer
      tiles: GPUTextureView
      tilesSecond: GPUTextureView | undefined
      group: GPUBindGroup
    }
  >
}

/** The group of the spatial anti-aliaser: the LDR luma and the mask the shading rejection
 *  wrote, and the target it stores to. */
const antiAliasGroup = ({ device, layouts, uniform }: Context, t: AnalysisTargetViews) =>
  device.createBindGroup({
    layout: layouts.antiAlias,
    entries: namedEntries(SPATIAL_AA_BINDINGS, {
      luma: t.luma,
      view: { buffer: uniform },
      mask: t.antiAliasMask,
      out: t.antiAliasing,
    }),
  })

/** The places of the groups the slots of the frames decide, in the order of the dispatches. */
const REPROJECT_AT = 1,
  REJECT_SHADING_AT = 4

/** The group `map` holds for `key`, made by `make` the first time. */
function memo(map: Map<number, GPUBindGroup>, key: number, make: () => GPUBindGroup) {
  let group = map.get(key)
  if (!group) map.set(key, (group = make()))
  return group
}

/** The groups of a new identity of the inputs: those that do not depend on the frames' slots, the
 *  others left to `of` (`REPROJECT_AT`, `REJECT_SHADING_AT`). */
function heldGroupsOf(context: Context, inputs: TaaInputs, t: AnalysisTargetViews): HeldGroups {
  const placed = undefined as never
  return {
    groups: [
      velocityGroup(context, inputs, t),
      placed,
      thinGroup(context, inputs, t),
      relaxationGroup(context, inputs, t),
      placed,
      antiAliasGroup(context, t),
    ],
    reproject: new Map(),
    rejectShading: new Map(),
    fused: new Map(),
  }
}

/** The group of the nearest velocity that flattens the blur's motion into `flatten`, made once for
 *  each image it flattens into and again where any view it binds is another (the tiles too, not
 *  only the flat image). */
function fusedGroupOf(
  context: Context,
  { fused }: HeldGroups,
  inputs: TaaInputs,
  t: AnalysisTargetViews,
  flatten: FusedFlatten,
) {
  let made = fused.get(flatten.flat)
  const { params, tiles, tilesSecond } = flatten
  if (!made || made.params !== params || made.tiles !== tiles || made.tilesSecond !== tilesSecond) {
    // One blur flattens here: the images it left are gone.
    fused.clear()
    made = { params, tiles, tilesSecond, group: fusedVelocityGroup(context, inputs, t, flatten) }
    fused.set(flatten.flat, made)
  }
  return made.group
}

/**
 * THE GROUPS OF THE ANALYSIS'S DISPATCHES that name the frame's inputs, in the order of their
 * pipelines: one set for each identity of the inputs, two held — the lit image is one of two
 * targets taking turns —, made again where what they name moved (`of`) and forgotten with the
 * targets they name (`clear`). The groups that name the shading histories of the frames — the
 * reprojection's, the shading rejection's — are made once for each slot the history walks
 * (`FrameSlices`).
 */
export function createAnalysisGroups(
  device: GPUDevice,
  layouts: AnalysisLayouts,
  uniform: GPUBuffer,
  sampler: GPUSampler,
) {
  const identity = createWebgpuBindIdentity(2)
  /** Per identity slot: each dispatch's group. */
  const held: (HeldGroups | undefined)[] = []
  const context: Context = { device, layouts, uniform, sampler }
  return {
    /** The groups naming the frame's `inputs` and the targets `t`, for the frames of `slices`. */
    of(inputs: TaaInputs, t: AnalysisTargetViews, slices: FrameSlices) {
      const { next } = identity
      for (let i = 0; i < ANALYSIS_INPUTS.length; i++) next[i] = inputs[ANALYSIS_INPUTS[i]]
      // The colour atlas's views and page table the groups bind, never the atlas object a resize of
      // its pool keeps (`velocityAtlasBound`).
      const atlas = velocityAtlasBound(inputs)
      for (let k = 0; k < atlas.length; k++) next[ANALYSIS_INPUTS.length + k] = atlas[k]
      const moved = identity.moved()
      let kept = held[identity.slot]
      if (moved || !kept) held[identity.slot] = kept = heldGroupsOf(context, inputs, t)
      const { groups } = kept
      const frames = t.guides.length
      groups[REPROJECT_AT] = memo(
        kept.reproject,
        slices.previous * frames + slices.resurrection,
        () => reprojectGroup(context, inputs, t, slices.previous, slices.resurrection),
      )
      groups[REJECT_SHADING_AT] = memo(kept.rejectShading, slices.current, () =>
        rejectShadingGroup(context, inputs, t, slices.current),
      )
      return groups
    },
    /** The group of the nearest velocity that flattens the blur's motion into `flatten`, for the
     *  inputs the last `of` was asked. */
    fused(inputs: TaaInputs, t: AnalysisTargetViews, flatten: FusedFlatten) {
      return fusedGroupOf(context, held[identity.slot]!, inputs, t, flatten)
    },
    clear() {
      identity.clear()
      held.length = 0
    },
  }
}
