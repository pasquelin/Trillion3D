import { namedEntries } from '../../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { velocityInputResources, type TaaInputs } from './inputs.ts'
import type { AnalysisLayouts } from './analysisLayouts.ts'
import type { AnalysisTargetViews } from './analysisTargets.ts'
import { VELOCITY_BINDINGS } from './nearestVelocityWgsl.ts'
import { REPROJECT_BINDINGS } from './reprojectWgsl.ts'
import { FLICKER_BINDINGS } from './flickerWgsl.ts'
import { THIN_GEOMETRY_BINDINGS } from './thinGeometryWgsl.ts'
import { HELD_MEASURE_BINDINGS, REJECTION_BINDINGS } from './rejectionWgsl.ts'

/** What the analysis reads of the frame (`TaaInputs`), in its groups' identity order. */
const ANALYSIS_INPUTS = [
  'current',
  'depth',
  'ids',
  'pages',
  'motion',
  'vectors',
  'pool',
  'positions',
  'uvs',
  'boxes',
  'reactive',
] as const

/** What a group is made of: the device, the layouts and the uniform and sampler its groups name. */
type Context = {
  device: GPUDevice
  layouts: AnalysisLayouts
  uniform: GPUBuffer
  sampler: GPUSampler
}

/** The groups of the nearest velocity and of the reprojection: the frame's surfaces, the velocity
 *  stage's vectors and depth, and the targets. */
function texelGroups(
  { device, layouts, uniform, sampler }: Context,
  inputs: TaaInputs,
  t: AnalysisTargetViews,
) {
  const occluders = { buffer: t.occluders }
  return [
    device.createBindGroup({
      layout: layouts.velocity,
      entries: namedEntries(VELOCITY_BINDINGS, {
        ...velocityInputResources(inputs, uniform),
        closest: t.closest,
        marks: t.marks,
        occluders,
      }),
    }),
    device.createBindGroup({
      layout: layouts.reproject,
      entries: namedEntries(REPROJECT_BINDINGS, {
        view: { buffer: uniform },
        marks: t.marks,
        closest: t.closest,
        vectors: inputs.vectors,
        occluders,
        prevShading: t.shading,
        historySampler: sampler,
        prevFlicker: t.flicker,
        shading: t.shadingReprojected,
        flicker: t.flickerThenLuma,
        word: t.reprojected,
        filled: t.filled,
        prevThin: t.thin,
        depth: inputs.depth,
      }),
    }),
  ]
}

/** The groups of the thin geometry detection, the flicker measure and the held measure. */
function measureGroups(
  { device, layouts, uniform }: Context,
  inputs: TaaInputs,
  t: AnalysisTargetViews,
) {
  const view = { buffer: uniform }
  const reactive = inputs.reactive!
  return [
    device.createBindGroup({
      layout: layouts.thin,
      entries: namedEntries(THIN_GEOMETRY_BINDINGS, {
        view,
        depth: inputs.depth,
        ids: inputs.ids,
        pages: { buffer: inputs.pages },
        marks: t.marks,
        word: t.reprojected,
        current: inputs.current,
        reactive,
        thinOut: t.thin,
      }),
    }),
    device.createBindGroup({
      layout: layouts.flicker,
      entries: namedEntries(FLICKER_BINDINGS, {
        view,
        current: inputs.current,
        reactive,
        word: t.reprojected,
        flicker: t.flickerThenLuma,
        marks: t.marks,
        flickerOut: t.flicker,
        error: t.closest,
        thin: t.thin,
      }),
    }),
    device.createBindGroup({
      layout: layouts.held,
      entries: namedEntries(HELD_MEASURE_BINDINGS, {
        view,
        current: inputs.current,
        word: t.reprojected,
        shading: t.shadingReprojected,
        filteredInput: t.filteredInput,
        filteredHistory: t.filteredHistory,
        filteredError: t.filteredError,
        occluders: { buffer: t.occluders },
      }),
    }),
  ]
}

/** The group of the shading rejection. */
const rejectionGroup = (
  { device, layouts, uniform }: Context,
  inputs: TaaInputs,
  t: AnalysisTargetViews,
) =>
  device.createBindGroup({
    layout: layouts.rejection,
    entries: namedEntries(REJECTION_BINDINGS, {
      view: { buffer: uniform },
      current: inputs.current,
      word: t.reprojected,
      shading: t.shadingReprojected,
      flicker: t.closest,
      shadingOut: t.shading,
      rejection: t.rejection,
      luma: t.flickerThenLuma,
      flickerHistory: t.flicker,
      reactive: inputs.reactive!,
      marks: t.marks,
      thin: t.thin,
      filteredInput: t.filteredInput,
      filteredHistory: t.filteredHistory,
      filteredError: t.filteredError,
    }),
  })

/**
 * THE GROUPS OF THE ANALYSIS'S DISPATCHES that name the frame's inputs, in the order of their
 * pipelines: one set for each identity of the inputs, two held — the lit image is one of two
 * targets taking turns —, made again where what they name moved (`of`) and forgotten with the
 * targets they name (`clear`).
 */
export function createAnalysisGroups(
  device: GPUDevice,
  layouts: AnalysisLayouts,
  uniform: GPUBuffer,
  sampler: GPUSampler,
) {
  const identity = createWebgpuBindIdentity(2)
  /** Per identity slot: each dispatch's group. */
  const held: (GPUBindGroup[] | undefined)[] = []
  const context: Context = { device, layouts, uniform, sampler }
  return {
    /** The groups naming the frame's `inputs` and the targets `t`. */
    of(inputs: TaaInputs, t: AnalysisTargetViews) {
      const { next } = identity
      for (let i = 0; i < ANALYSIS_INPUTS.length; i++) next[i] = inputs[ANALYSIS_INPUTS[i]]
      const moved = identity.moved()
      const kept = held[identity.slot]
      if (!moved && kept) return kept
      const [velocity, reproject] = texelGroups(context, inputs, t)
      const [thin, flicker, heldMeasure] = measureGroups(context, inputs, t)
      const groups = [
        velocity,
        reproject,
        thin,
        flicker,
        heldMeasure,
        rejectionGroup(context, inputs, t),
      ]
      held[identity.slot] = groups
      return groups
    },
    clear() {
      identity.clear()
      held.length = 0
    },
  }
}
