import { dagReadEntries, type DagReadTables } from '../../gpu/dag/shader/bindings.ts'
import { autoKernel } from '../../gpu/core/computeStages.ts'
import { dispatchRows, groupWidth, WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { composeGroup, heldGroup } from '../core/bindIdentity.ts'
import { bufferEntry } from '../core/liveEntries.ts'
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

/** What the pass's groups name, written at each batch and read live by their entries. */
type RayBound = {
  params: GPUBuffer
  query: GPUBuffer
  pageTable: GPUBuffer
  entries: GPUBuffer
  spans: GPUBuffer
  geometry: GPUBuffer
  positions: GPUBuffer
  views: DagReadTables
}

/** The pass's three groups — the index's, the trace's over the cut's tables, the trace's own —,
 *  each held over what it names, read live (`liveEntries.ts`): made again only when the pipeline
 *  or a resource moved. Their entries are made once: a batch allocates none. */
export function createRayGroups() {
  const bound = {} as RayBound
  const at = (binding: number, name: Exclude<keyof RayBound, 'views'>) =>
    bufferEntry(binding, () => bound[name])
  const params = bufferEntry(
    0,
    () => bound.params,
    undefined,
    () => RAY_PARAMS.words * 4,
  )
  const index = heldGroup(),
    tables = heldGroup(),
    trace = heldGroup()
  index.identity.entries[0] = [
    params,
    at(1, 'query'),
    at(2, 'pageTable'),
    at(3, 'entries'),
    at(4, 'spans'),
  ]
  tables.identity.entries[0] = dagReadEntries(() => bound.views)
  trace.identity.entries[0] = [params, at(1, 'query'), at(2, 'geometry'), at(3, 'positions')]
  return { bound, index, tables, trace }
}
type RayGroups = ReturnType<typeof createRayGroups>

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
    { groups } = q,
    { bound } = groups
  bound.params = q.params
  bound.query = q.buffer
  bound.pageTable = sources.pageTable
  bound.entries = sources.entries
  bound.spans = sources.spans
  bound.geometry = sources.geometry
  bound.positions = sources.positions
  bound.views = sources.tables.views
  const pass = encoder.beginComputePass({ label: RAY_QUERY_PASS })
  const indexed = sources.rows + sources.entryCount
  // Nothing to index: a dispatch of no workgroup is refused, and every lookup finds none.
  if (indexed > 0) {
    pass.setPipeline(index)
    composeGroup(device, groups.index, index)
    pass.setBindGroup(0, groups.index.group!)
    dispatchRows(pass, ceilDiv(indexed, WORKGROUP_THREADS), 1, width)
  }
  pass.setPipeline(trace)
  // Group 0: the cut's record tables, at the culling's bindings (`dagReadEntries`).
  composeGroup(device, groups.tables, trace)
  pass.setBindGroup(0, groups.tables.group!)
  composeGroup(device, groups.trace, trace, 1)
  pass.setBindGroup(1, groups.trace.group!)
  dispatchRows(pass, ceilDiv(q.rays, WORKGROUP_THREADS), 1, width)
  pass.end()
}
