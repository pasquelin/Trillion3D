import { PARTITION_WORKGROUP, ROW_DATA_U32 } from './contract.ts'
import { partitionClearThreads } from './clearWgsl.ts'
import type { OpenPass } from '../core/lazyComputePass.ts'
import {
  createGpuPartitionBuffers,
  createGpuPartitionGroup,
  createGpuPartitionRows,
} from './buffers.ts'
import { pendingBuffers } from '../core/tableGrowth.ts'
import type { createPartitionUniformWriter, PartitionFrame } from './uniform.ts'
import type { createPartitionCounters } from './counters.ts'
import { constructGpuResources } from '../core/errorScope.ts'
import type { KeptFrame, PartitionSources } from './types.ts'
import { ceilDiv, workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { dispatchGrid } from '../dag/shader/gridWgsl.ts'

/** The partition's kernels, in the order a frame dispatches them. */
export const KERNELS = ['clearRows', 'projectRows', 'classifyRows'] as const
const CLEAR = 0,
  PROJECT = 1

type Allocated = ReturnType<typeof createGpuPartitionBuffers>

/** What the partition's methods share (`factory.ts`): its buffers and kernels, each kernel's
 *  group, the frame's state, the rows to forget, the frame kept for the audit. */
export type Partition = {
  device: GPUDevice
  allocated: Allocated
  inputs: PartitionSources
  buffers: Allocated & Omit<PartitionSources, 'pyramid'> & { pyramid: GPUBuffer }
  layouts: GPUBindGroupLayout[]
  pipelines: GPUComputePipeline[]
  /** Each kernel's group on the buffers of the moment, in `KERNELS` order. */
  groups: GPUBindGroup[]
  running: boolean
  counting: boolean
  disposed: boolean
  writeUniform: ReturnType<typeof createPartitionUniformWriter>
  forgotten: number[]
  kept: KeptFrame
  lastFrame: KeptFrame | undefined
  counters: ReturnType<typeof createPartitionCounters>
}

/** Each kernel's group made again on the buffers of the moment. */
export function regroupPartition(p: Partition) {
  const { device, layouts, buffers } = p
  p.groups = KERNELS.map((kernel, k) =>
    createGpuPartitionGroup(device, layouts[k], kernel, buffers),
  )
}

/** The rows grown to `rows`, put in place by the pending growth's commit (`GpuPartition.grow`). */
export function growPartition(
  p: Partition,
  rows: number,
  next: () => Omit<PartitionSources, 'pyramid'>,
) {
  const { device, allocated } = p
  const grown = constructGpuResources(device, () => createGpuPartitionRows(device, rows))
  return pendingBuffers(grown.all, () => {
    const old = [allocated.corners, allocated.rowData, allocated.tested]
    const all = [...grown.all, allocated.state, allocated.uniforms]
    Object.assign(allocated, grown, { all })
    const read = next()
    Object.assign(p.inputs, read)
    Object.assign(p.buffers, grown, read)
    regroupPartition(p)
    // The new rows hold nothing: every one reads as never projected.
    p.forgotten.length = 0
    return old
  })
}

/** The frame's rows forgotten, its uniforms written and kept, the projection's group following
 *  the pyramid (`GpuPartition.beginFrame`). */
export function beginPartitionFrame(
  p: Partition,
  encoder: GPUCommandEncoder,
  frame: PartitionFrame,
) {
  if (p.disposed) return
  const { allocated, forgotten, kept, buffers } = p
  const rowBytes = ROW_DATA_U32 * 4
  // Zero flags are a row never projected: the kernel keeps nothing of what they held.
  for (let i = 0; i < forgotten.length; i += 2) {
    const from = forgotten[i],
      to = Math.min(forgotten[i + 1], allocated.rows - 1)
    if (to >= from)
      encoder.clearBuffer(allocated.rowData, from * rowBytes, (to - from + 1) * rowBytes)
  }
  forgotten.length = 0
  const pyramid = p.inputs.pyramid()
  // A frame without a pyramid runs no kernel: it counts nothing, and its sample waits.
  p.running = !!pyramid
  p.counting = p.running && frame.counting
  if (!pyramid) return
  const rows = Math.min(frame.rows, allocated.rows)
  p.writeUniform(p.device, allocated.uniforms, frame, rows)
  kept.rows = rows
  kept.width = frame.width
  kept.height = frame.height
  kept.near = frame.near
  kept.view.set(frame.view)
  kept.viewProj.set(frame.viewProj)
  p.lastFrame = kept
  if (pyramid !== buffers.pyramid) {
    buffers.pyramid = pyramid
    const layout = p.layouts[PROJECT]
    p.groups[PROJECT] = createGpuPartitionGroup(p.device, layout, 'projectRows', buffers)
  }
}

/** The partition's dispatches in the frame's compute pass (`GpuPartition.encode`). */
export function encodePartition(p: Partition, open: OpenPass) {
  if (p.disposed || !p.running) return
  // Nothing is held from frame to frame but the history, which lives in `rowData`:
  // counters, rest bits and per-slot counts start from zero, cleared by the pass's first
  // dispatch; then each row is projected, then classified.
  const pass = open.pass,
    rows = p.kept.rows,
    rowGrid = dispatchGrid(workgroupCount(rows, PARTITION_WORKGROUP))
  const clearThreads = partitionClearThreads(rows, p.inputs.slotUsed.size / 4)
  // In rows past one dimension's groups: each kernel reads its flat index (`flatIndex`).
  const clearGrid = dispatchGrid(ceilDiv(clearThreads, PARTITION_WORKGROUP))
  for (let k = 0; k < KERNELS.length; k++) {
    pass.setPipeline(p.pipelines[k])
    pass.setBindGroup(0, p.groups[k])
    const [x, y] = k === CLEAR ? clearGrid : rowGrid
    pass.dispatchWorkgroups(x, y)
  }
}
