import type { CutTables } from '../../gpu/dag/cutReaders.ts'
import { dagReadEntries } from '../../gpu/dag/shader/bindings.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { dispatchRows, groupWidth, WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { preparedComputePipeline } from '../../lighting/deferred/fullscreen.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { RAY_QUERY_WGSL } from './rayQueryWgsl.ts'
import type { RayRecords } from './rayRecords.ts'
import { DEFORM_INDEX_SHADER, RAY_PARAMS } from './deformIndexWgsl.ts'

/** The ray query's label: its buffers, its kernels and its pass. */
export const RAY_QUERY_PASS = 'Trillion3D ray query'

/** What a batch of rays reads where it lies: the cut's tables (`../../gpu/dag/cutReaders.ts`), the
 *  records (`rayRecords.ts`), the page table and its visibility rows, the blended entries and their
 *  spans, the geometry pool's words and the float pool. */
export type RaySources = {
  tables: CutTables
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
export type RayBatch = { words: Uint32Array<ArrayBuffer>; rays: number; filterWord: number }

/** A compute pipeline of the query on `module`, prepared off the frame. */
const computeOf = (device: GPUDevice, module: GPUShaderModule, entryPoint: string) =>
  preparedComputePipeline(device, {
    label: RAY_QUERY_PASS,
    layout: 'auto',
    compute: { module, entryPoint },
  })

/** The trace kernel of a device, one whatever the world, and its deformation index kernel. */
const traceKernel = oncePerDevice((device: GPUDevice) =>
  computeOf(
    device,
    device.createShaderModule({ label: RAY_QUERY_PASS, code: RAY_QUERY_WGSL }),
    'traceRays',
  ),
)
const indexKernel = oncePerDevice((device: GPUDevice) =>
  computeOf(
    device,
    device.createShaderModule({ label: RAY_QUERY_PASS, code: DEFORM_INDEX_SHADER }),
    'indexDeformed',
  ),
)

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

/** The index, then the trace, in one compute pass. */
export function encodeRayPass(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  sources: RaySources,
  q: { buffer: GPUBuffer; params: GPUBuffer; rays: number },
) {
  const trace = traceKernel(device).get(),
    index = indexKernel(device).get(),
    width = groupWidth(device.limits)
  const params = { buffer: q.params, size: RAY_PARAMS.words * 4 }
  const pass = encoder.beginComputePass({ label: RAY_QUERY_PASS })
  const indexed = sources.rows + sources.entryCount
  // Nothing to index: a dispatch of no workgroup is refused, and every lookup finds none.
  if (indexed > 0) {
    pass.setPipeline(index)
    const own = [sources.pageTable, sources.entries, sources.spans].map((buffer) => ({ buffer }))
    pass.setBindGroup(0, groupOf(device, index, 0, [params, { buffer: q.buffer }, ...own]))
    dispatchRows(pass, ceilDiv(indexed, WORKGROUP_THREADS), 1, width)
  }
  pass.setPipeline(trace)
  // Group 0: the cut's record tables, at the culling's bindings (`dagReadEntries`).
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: trace.getBindGroupLayout(0),
      entries: dagReadEntries(sources.tables.views),
    }),
  )
  const own = [q.buffer, sources.geometry, sources.positions].map((buffer) => ({ buffer }))
  pass.setBindGroup(1, groupOf(device, trace, 1, [params, ...own]))
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
