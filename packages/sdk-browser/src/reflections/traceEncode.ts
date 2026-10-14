import { namedEntries } from '../gpu/core/computeBindings.ts'
import type { WebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { BEGIN_BINDINGS, TRACE_BINDINGS } from './traceBindings.ts'
import type { createTraceStages, TraceTiles } from './trace.ts'

/** What the trace reads of the frame: its surface targets, the lights, the bounce cascades and the
 *  resident proxy, the deferred lighting's view. */
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

/** The groups of a trace: the trace's, the classification's and the frame state's. */
export type TraceGroups = { trace: GPUBindGroup; classify: GPUBindGroup; begin: GPUBindGroup }

/** What a view's trace holds: the target it writes, its view uniform, its tile list, and its groups
 *  under the identity of the resources they name (`createWebgpuBindIdentity`). */
type TraceResources = {
  device: GPUDevice
  targetView: GPUTextureView
  uniform: GPUBuffer
  tiles: TraceTiles
  trace: { identity: WebgpuBindIdentity; groups?: TraceGroups }
}

/** The bind groups of `reflection`'s trace over `inputs`, made again when a resource they name is
 *  not the one they were made over. */
function traceGroups(
  reflection: TraceResources,
  stages: Awaited<ReturnType<typeof createTraceStages>>,
  inputs: TraceInputs,
) {
  const { device, targetView, tiles, trace } = reflection
  const { next } = trace.identity
  next.length = 0
  next.push(
    stages,
    inputs.base,
    inputs.flags,
    inputs.normals,
    inputs.lobes,
    inputs.lights,
    inputs.bounceGrid,
    inputs.probes,
    inputs.proxy,
    inputs.proxyWorlds,
    inputs.proxyTree,
    inputs.lightLists,
  )
  if (!trace.identity.moved() && trace.groups) return trace.groups
  return (trace.groups = {
    trace: device.createBindGroup({
      layout: stages.traceLayout,
      entries: namedEntries(TRACE_BINDINGS, {
        flags: inputs.flags,
        normals: inputs.normals,
        target: targetView,
        lights: { buffer: inputs.lights },
        lobes: inputs.lobes,
        bounceGrid: { buffer: inputs.bounceGrid },
        probes: inputs.probes,
        list: { buffer: tiles.list },
        base: inputs.base,
        lightLists: { buffer: inputs.lightLists },
        proxy: { buffer: inputs.proxy },
        proxyWorlds: inputs.proxyWorlds,
        proxyTree: inputs.proxyTree,
      }),
    }),
    classify: device.createBindGroup({
      layout: stages.classifyLayout,
      entries: namedEntries(TRACE_BINDINGS, {
        flags: inputs.flags,
        work: { buffer: tiles.args },
        list: { buffer: tiles.list },
      }),
    }),
    begin: device.createBindGroup({
      layout: stages.beginLayout,
      entries: namedEntries(BEGIN_BINDINGS, {
        work: { buffer: tiles.args },
        list: { buffer: tiles.list },
      }),
    }),
  })
}

/**
 * The frame state, the tile classification and the opaque trace, over the pixels of `size`, in the
 * open compute `pass`: `depthGroup` is the reflection group over the depth pyramid.
 */
export function encodeReflectionTrace(
  pass: GPUComputePassEncoder,
  reflection: TraceResources,
  stages: Awaited<ReturnType<typeof createTraceStages>>,
  inputs: TraceInputs,
  depthGroup: GPUBindGroup,
  size: readonly [number, number],
) {
  const groups = traceGroups(reflection, stages, inputs)
  pass.setPipeline(stages.beginPipeline)
  pass.setBindGroup(0, groups.begin)
  pass.dispatchWorkgroups(1)
  pass.setPipeline(stages.classifyPipeline)
  pass.setBindGroup(0, groups.classify)
  pass.setBindGroup(1, depthGroup)
  pass.dispatchWorkgroups(ceilDiv(size[0], REFLECTION_SIDE), ceilDiv(size[1], REFLECTION_SIDE))
  pass.setPipeline(stages.tracePipeline)
  pass.setBindGroup(0, groups.trace)
  pass.dispatchWorkgroupsIndirect(reflection.tiles.args, 0)
}
