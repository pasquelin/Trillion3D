import { dagReadEntries } from '../../gpu/dag/shader/bindings.ts'
import { autoKernel } from '../../gpu/core/computeStages.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { dispatchRows, groupWidth, WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { createWebgpuBindIdentity } from '../core/bindIdentity.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { RAY_QUERY_WGSL } from './rayQueryWgsl.ts'
import type { RaySources } from './raySources.ts'
import { DEFORM_INDEX_SHADER, RAY_PARAMS } from './deformIndexWgsl.ts'

/** The ray query's label: its buffers, its kernels and its pass. */
export const RAY_QUERY_PASS = 'Trillion3D ray query'

/** A batch: its rays' records then their filter lists, as words (`rayRecord.ts`), and its rays. */
export type RayBatch = { words: Uint32Array<ArrayBuffer>; rays: number; filterWord: number }

/** The trace kernel of a device, one whatever the world, and its deformation index kernel. */
const traceKernel = autoKernel(RAY_QUERY_PASS, RAY_QUERY_WGSL, 'traceRays')
const indexKernel = autoKernel(RAY_QUERY_PASS, DEFORM_INDEX_SHADER, 'indexDeformed')

/** Whether both kernels of the query are compiled on `device`: when not, their compile is started
 *  and `then` is called once it lands — `failed`, with the device's reason, if it refuses it. */
export function rayKernelsCompiled(
  device: GPUDevice,
  then: () => void,
  failed: (reason: unknown) => void,
) {
  const kernels = [traceKernel(device), indexKernel(device)]
  if (kernels.every((kernel) => kernel.ready)) return true
  Promise.all(kernels.map((kernel) => kernel.prepare())).then(then, failed)
  return false
}

/** A group of the pass and what it names. */
const heldRayGroup = () => ({
  identity: createWebgpuBindIdentity(),
  group: undefined as unknown as GPUBindGroup,
})
type HeldRayGroup = ReturnType<typeof heldRayGroup>

/** The pass's three groups — the index's, the trace's over the cut's tables, the trace's own —,
 *  each held over what it names: made again only when the pipeline or a resource moved. */
export const createRayGroups = () => ({
  index: heldRayGroup(),
  tables: heldRayGroup(),
  trace: heldRayGroup(),
})
type RayGroups = ReturnType<typeof createRayGroups>

/** `held`'s group, made by `make` when `named` — its pipeline, then its resources — moved. */
function heldOver(held: HeldRayGroup, make: () => GPUBindGroup, ...named: unknown[]) {
  const { next } = held.identity
  next.length = named.length
  for (let i = 0; i < named.length; i++) next[i] = named[i]
  if (held.identity.moved()) held.group = make()
  return held.group
}

/** The index, then the trace, in one compute pass. */
export function encodeRayPass(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  sources: RaySources,
  q: { buffer: GPUBuffer; params: GPUBuffer; rays: number; groups: RayGroups },
) {
  const trace = traceKernel(device).get(),
    index = indexKernel(device).get(),
    width = groupWidth(device.limits),
    { pageTable, entries, spans, geometry, positions } = sources,
    { views } = sources.tables
  const params = { buffer: q.params, size: RAY_PARAMS.words * 4 }
  const pass = encoder.beginComputePass({ label: RAY_QUERY_PASS })
  const indexed = sources.rows + sources.entryCount
  // Nothing to index: a dispatch of no workgroup is refused, and every lookup finds none.
  if (indexed > 0) {
    pass.setPipeline(index)
    const make = () =>
      groupOf(device, index, 0, [
        params,
        ...[q.buffer, pageTable, entries, spans].map((buffer) => ({ buffer })),
      ])
    pass.setBindGroup(
      0,
      heldOver(q.groups.index, make, index, q.params, q.buffer, pageTable, entries, spans),
    )
    dispatchRows(pass, ceilDiv(indexed, WORKGROUP_THREADS), 1, width)
  }
  pass.setPipeline(trace)
  // Group 0: the cut's record tables, at the culling's bindings (`dagReadEntries`).
  const tables = () =>
    device.createBindGroup({ layout: trace.getBindGroupLayout(0), entries: dagReadEntries(views) })
  pass.setBindGroup(
    0,
    heldOver(q.groups.tables, tables, trace, views.nodes, views.frames, views.worlds, views.tree),
  )
  const own = () =>
    groupOf(device, trace, 1, [
      params,
      ...[q.buffer, geometry, positions].map((buffer) => ({ buffer })),
    ])
  pass.setBindGroup(
    1,
    heldOver(q.groups.trace, own, trace, q.params, q.buffer, geometry, positions),
  )
  dispatchRows(pass, ceilDiv(q.rays, WORKGROUP_THREADS), 1, width)
  pass.end()
}

/** Group `group` of `pipeline`, its resources at bindings 0 on. */
const groupOf = (
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  group: number,
  resources: GPUBufferBinding[],
) =>
  device.createBindGroup({
    layout: pipeline.getBindGroupLayout(group),
    entries: sequentialEntries(resources),
  })
