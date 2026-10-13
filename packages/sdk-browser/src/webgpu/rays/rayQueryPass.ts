import type { CutTables, GpuSelection } from '../../gpu/core/selection.ts'
import { nodeLayout } from '../../gpu/dag/treeRefit.ts'
import { DAG_BINDING, dagPartEntries } from '../../gpu/dag/shader/bindings.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { dispatchRows, groupWidth } from '../../gpu/dispatch/grid.ts'
import { preparedComputePipeline, preparedPipelines } from '../../lighting/deferred/fullscreen.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { RAY_LANES, rayQueryWgsl } from './rayQueryWgsl.ts'
import type { RayLayout } from './rayPlacementWgsl.ts'
import type { RayRecords } from './rayRecords.ts'
import { DEFORM_INDEX_SHADER, RAY_PARAMS } from './deformIndexWgsl.ts'

/** The ray query's label: its buffers, its kernels and its pass. */
export const RAY_QUERY_PASS = 'Trillion3D ray query'

/** What a batch of rays reads where it lies: the cut's tables and ranges, the records
 *  (`rayRecords.ts`), the page table and its visibility rows, the blended entries and their spans,
 *  the geometry pool's words and the float pool. */
export type RaySources = {
  tables: CutTables
  ranges: GpuSelection['worldRanges']
  records: RayRecords
  pageTable: GPUBuffer
  rows: number
  entries: GPUBuffer
  spans: GPUBuffer
  entryCount: number
  geometry: GPUBuffer
  positions: GPUBuffer
}

/** A batch: its rays' records then their filter lists, as words (`rayRecord.ts`), and its rays. */
export type RayBatch = { words: Uint32Array; rays: number; filterWord: number }

/** A compute pipeline of the query on `module`, prepared off the frame. */
const computeOf = (device: GPUDevice, module: GPUShaderModule, entryPoint: string) =>
  preparedComputePipeline(device, {
    label: RAY_QUERY_PASS,
    layout: 'auto',
    compute: { module, entryPoint },
  })

/** The trace kernels of a device, one a layout of the nodes, and its deformation index kernel. */
const traceKernels = oncePerDevice((device: GPUDevice) =>
  preparedPipelines(
    (layout: RayLayout) =>
      computeOf(
        device,
        device.createShaderModule({ label: RAY_QUERY_PASS, code: rayQueryWgsl(layout) }),
        'traceRays',
      ),
    (layout) => JSON.stringify(layout),
  ),
)
const indexKernel = oncePerDevice((device: GPUDevice) =>
  computeOf(
    device,
    device.createShaderModule({ label: RAY_QUERY_PASS, code: DEFORM_INDEX_SHADER }),
    'indexDeformed',
  ),
)

/** Whether both kernels of the query for `sources` are compiled on `device`: when not, their
 *  compile is started and `then` is called once it lands — `failed` if the device refuses it. */
export function rayKernelsCompiled(
  device: GPUDevice,
  sources: RaySources,
  then: () => void,
  failed: () => void,
) {
  const kernels = [traceKernels(device).of(layoutOf(sources)), indexKernel(device)]
  if (kernels.every((kernel) => kernel.ready)) return true
  Promise.all(kernels.map((kernel) => kernel.prepare())).then(then, failed)
  return false
}

/** How `sources` lay the cut's nodes out on the device: what a trace kernel is made for. */
const layoutOf = ({ tables }: RaySources): RayLayout => ({ nodes: nodeLayout(tables.nodeParts) })

/** The index, then a trace a range, in one compute pass. */
export function encodeRayPass(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  sources: RaySources,
  q: { buffer: GPUBuffer; slots: GPUBuffer; stride: number; rays: number },
) {
  const trace = traceKernels(device).of(layoutOf(sources)).get(),
    index = indexKernel(device).get(),
    width = groupWidth(device.limits)
  const slot = (r: number) => ({
    buffer: q.slots,
    offset: r * q.stride,
    size: RAY_PARAMS.words * 4,
  })
  const pass = encoder.beginComputePass({ label: RAY_QUERY_PASS })
  const indexed = sources.rows + sources.entryCount
  // Nothing to index: a dispatch of no workgroup is refused, and every lookup finds none.
  if (indexed > 0) {
    pass.setPipeline(index)
    const own = [sources.pageTable, sources.entries, sources.spans].map((buffer) => ({ buffer }))
    pass.setBindGroup(0, groupOf(device, index, 0, [slot(0), { buffer: q.buffer }, ...own]))
    dispatchRows(pass, ceilDiv(indexed, 64), 1, width)
  }
  pass.setPipeline(trace)
  pass.setBindGroup(0, nodesGroup(device, trace, sources.tables))
  sources.ranges.forEach(({ frames, buffer: worlds }, r) => {
    const own = [q.buffer, sources.geometry, sources.positions, frames, worlds].map((buffer) => ({
      buffer,
    }))
    pass.setBindGroup(1, groupOf(device, trace, 1, [slot(r), ...own]))
    dispatchRows(pass, ceilDiv(q.rays, RAY_LANES), 1, width)
  })
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

/** Group 0 of the trace: the cut's nodes at the cut's binding, their further parts after. */
const nodesGroup = (device: GPUDevice, pipeline: GPUComputePipeline, t: CutTables) =>
  device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: DAG_BINDING.nodes, resource: { buffer: t.nodeParts.buffers[0] } },
      ...dagPartEntries({ nodes: t.nodeParts.buffers.slice(1) }),
    ],
  })
