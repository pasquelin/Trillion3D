import { namedEntries } from '../gpu/core/computeBindings.ts'
import { buildComputeStages } from '../gpu/core/computeStages.ts'
import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { REFLECTION_SIDE } from './constants.ts'
import type { FrontLayer } from './frontLayer.ts'
import { REFLECTION_TRACE_BINDINGS, halfLayouts } from './halfBindings.ts'

/** What the trace reads of the frame: its surface targets, the lights, the bounce cascades and the
 *  resident proxy. */
export type TraceInputs = {
  base: GPUTextureView
  flags: GPUTextureView
  normals: GPUTextureView
  lobes: GPUTextureView
  lights: GPUBuffer
  /** The light grid's buffer, whose world lists the proxy hits walk (`bounceLightSlice`). */
  lightLists: GPUBuffer
  bounceGrid: GPUBuffer
  probes: GPUTextureView
  /** The proxy's buffers, or the empty one in each place (`gpu/dag/proxyInstances.ts`). */
  proxy: GPUBuffer
  /** The culling's records, the worlds the proxy places its meshes by and its instances
   *  (`gpu/dag/worldTable.ts`), or the stand-in. */
  proxyWorlds: GPUTextureView
  /** The culling's placement tree the proxy's rays walk (`gpu/dag/treeTable.ts`), or the stand-in. */
  proxyTree: GPUTextureView
}

/** The trace's four kernels on the reflection's module (`REFLECTION_TRACE_SHADER`), over the reflection
 *  group's layout `groupLayout` (`reflectionLayout`). */
export async function createTraceStages(
  device: GPUDevice,
  module: GPUShaderModule,
  groupLayout: GPUBindGroupLayout,
) {
  const { traceLayout, upsampleLayout } = halfLayouts(device)
  const [trace, upsample] = await Promise.all([
    buildComputeStages(device, [traceLayout, groupLayout], module, ['traceOpaque', 'traceFront']),
    buildComputeStages(device, [upsampleLayout, groupLayout], module, [
      'upsampleOpaque',
      'upsampleFront',
    ]),
  ])
  return { traceLayout, upsampleLayout, ...trace, ...upsample }
}
type TraceStages = Awaited<ReturnType<typeof createTraceStages>>

/** The groups of a trace: the trace's and the upsample's. */
type TraceGroups = { trace: GPUBindGroup; upsample: GPUBindGroup }

/** A view's trace groups, none made yet: made at the first trace (`traceGroups`). */
export const createTraceGroups = () => ({
  identity: createWebgpuBindIdentity(),
  groups: undefined as TraceGroups | undefined,
})

/** What a view's trace holds: the target the upsample writes, its half grid, the transparents' front
 *  layer (its surface, its half grid and the radiance the upsample writes) and its groups under the
 *  identity of the resources they name. */
type TraceResources = {
  device: GPUDevice
  targetView: GPUTextureView
  halfView: GPUTextureView
  front: { views: FrontLayer['views'] }
  trace: ReturnType<typeof createTraceGroups>
}

/** The bind groups of `reflection`'s trace over `inputs`, made again when a resource they name is
 *  not the one they were made over. */
function traceGroups(reflection: TraceResources, stages: TraceStages, inputs: TraceInputs) {
  const { device, targetView, halfView, trace } = reflection,
    front = reflection.front.views
  const { next } = trace.identity
  next.length = 0
  next.push(stages, targetView, halfView, front.flags, front.normals, front.lobes, front.half)
  next.push(front.traced, inputs.base, inputs.flags, inputs.normals, inputs.lobes, inputs.lights)
  next.push(inputs.lightLists, inputs.bounceGrid, inputs.probes, inputs.proxy, inputs.proxyWorlds)
  next.push(inputs.proxyTree)
  if (!trace.identity.moved() && trace.groups) return trace.groups
  const surfaces = {
    flags: inputs.flags,
    normals: inputs.normals,
    lobes: inputs.lobes,
    frontFlags: front.flags,
    frontNormals: front.normals,
    frontLobes: front.lobes,
    lights: { buffer: inputs.lights },
  }
  return (trace.groups = {
    trace: device.createBindGroup({
      layout: stages.traceLayout,
      entries: namedEntries(REFLECTION_TRACE_BINDINGS, {
        ...surfaces,
        lightLists: { buffer: inputs.lightLists },
        bounceGrid: { buffer: inputs.bounceGrid },
        probes: inputs.probes,
        proxy: { buffer: inputs.proxy },
        proxyWorlds: inputs.proxyWorlds,
        proxyTree: inputs.proxyTree,
        halfOut: halfView,
        frontHalfOut: front.half,
      }),
    }),
    upsample: device.createBindGroup({
      layout: stages.upsampleLayout,
      entries: namedEntries(REFLECTION_TRACE_BINDINGS, {
        ...surfaces,
        half: halfView,
        frontHalf: front.half,
        base: inputs.base,
        target: targetView,
        frontTarget: front.traced,
      }),
    }),
  })
}

/**
 * The reflections of the pixels of `size`, in the open compute `pass` (`traceHalf.ts`): the opaque
 * surface's half grid traced, then upsampled into the reflection target; with `front`, the image's
 * front pass having written a reflecting surface, the front surface's the same way. `depthGroup` is
 * the reflection group over the depth pyramid.
 */
export function encodeReflectionTrace(
  pass: GPUComputePassEncoder,
  reflection: TraceResources,
  stages: TraceStages,
  inputs: TraceInputs,
  depthGroup: GPUBindGroup,
  size: readonly [number, number],
  front: boolean,
) {
  const groups = traceGroups(reflection, stages, inputs)
  const halfX = ceilDiv(ceilDiv(size[0], 2), REFLECTION_SIDE),
    halfY = ceilDiv(ceilDiv(size[1], 2), REFLECTION_SIDE)
  pass.setBindGroup(1, depthGroup)
  pass.setBindGroup(0, groups.trace)
  pass.setPipeline(stages.traceOpaque)
  pass.dispatchWorkgroups(halfX, halfY)
  if (front) {
    pass.setPipeline(stages.traceFront)
    pass.dispatchWorkgroups(halfX, halfY)
  }
  pass.setBindGroup(0, groups.upsample)
  pass.setPipeline(stages.upsampleOpaque)
  pass.dispatchWorkgroups(ceilDiv(size[0], REFLECTION_SIDE), ceilDiv(size[1], REFLECTION_SIDE))
  if (!front) return
  pass.setPipeline(stages.upsampleFront)
  pass.dispatchWorkgroups(ceilDiv(size[0], REFLECTION_SIDE), ceilDiv(size[1], REFLECTION_SIDE))
}
