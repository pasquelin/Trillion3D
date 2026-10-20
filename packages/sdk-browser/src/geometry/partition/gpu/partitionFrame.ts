import { ROW_DATA_U32 } from './contract.ts'
import { partitionClearThreads } from './clearWgsl.ts'
import type { OpenPass } from '../../../gpu/core/lazyComputePass.ts'
import {
  createGpuPartitionBuffers,
  createGpuPartitionGroup,
  createGpuPartitionRows,
} from './buffers.ts'
import { pendingBuffers } from '../../../gpu/core/tableGrowth.ts'
import type { createPartitionUniformWriter, PartitionFrame } from './uniform.ts'
import type { createPartitionCounters } from './counters.ts'
import { constructGpuResources } from '../../../gpu/core/errorScope.ts'
import type { KeptFrame, PartitionSources } from './types.ts'
import type { CullStep, HeldCopy } from '../../../gpu/core/heldCopy.ts'
import { ceilDiv, workgroupCount } from '../../../../../math/src/scalar/integers.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'

/** The partition's kernels, in the order a frame dispatches them. */
export const KERNELS = ['clearRows', 'projectRows', 'classifyRows'] as const
const CLEAR = 0,
  PROJECT = 1,
  CLASSIFY = 2

type Allocated = ReturnType<typeof createGpuPartitionBuffers>

/** What the partition's methods share (`factory.ts`): its buffers and kernels, each kernel's
 *  group, the frame's state, the rows to forget, the frame kept for the audit. */
export type Partition = {
  device: GPUDevice
  allocated: Allocated
  inputs: PartitionSources
  /** Its resources by binding: the cut's draw mask the frame's (`PartitionFrame.selection`), the
   *  items when it has none — bound, never read. */
  buffers: Allocated &
    Omit<PartitionSources, 'pyramid'> & { pyramid: GPUTextureView; selectionMask: GPUBuffer }
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
  /** The verdicts and rest bits a frozen cut tested, kept aside (`heldCopy.ts`): what its images
   *  draw again whatever a view drawn aside wrote in the buffers they share. */
  heldFlags: HeldCopy
  heldRest: HeldCopy
  /** What this image does with its occlusion (`PartitionFrame.cull`). */
  cull: CullStep
  /** This image draws the kept verdicts again: nothing is tested. */
  held: boolean
  /** This image's verdicts are the first a frozen cut keeps (`keepPartitionVerdicts`). */
  keepDue: boolean
}

/** Each kernel's group made again on the buffers of the moment. */
export function regroupPartition(p: Partition) {
  const { device, layouts, buffers } = p
  p.groups = KERNELS.map((kernel, k) =>
    createGpuPartitionGroup(device, layouts[k], kernel, buffers),
  )
}

/** The partition reads what `next` gives from now on, its groups made again (`GpuPartition.rebind`). */
export function rebindPartition(p: Partition, next: () => Omit<PartitionSources, 'pyramid'>) {
  const read = next(),
    { buffers } = p
  // The items standing in for a mask follow the items.
  if (buffers.selectionMask === buffers.items) buffers.selectionMask = read.items
  Object.assign(p.inputs, read)
  Object.assign(buffers, read)
  regroupPartition(p)
}

/** The rows grown to `rows`, put in place by the pending growth's commit (`GpuPartition.grow`). */
export function growPartition(
  p: Partition,
  rows: number,
  next: () => Omit<PartitionSources, 'pyramid'>,
) {
  const { device, allocated } = p
  const grown = constructGpuResources(device, () => createGpuPartitionRows(device, rows))
  return pendingBuffers(device, grown.all, () => {
    const old = [allocated.corners, allocated.rowData, allocated.tested]
    const all = [...grown.all, allocated.state, allocated.uniforms]
    Object.assign(allocated, grown, { all })
    Object.assign(p.buffers, grown)
    rebindPartition(p, next)
    // The new rows hold nothing: every one reads as never projected.
    p.forgotten.length = 0
    return old
  })
}

/** The frame's rows forgotten, its uniforms written and kept, the projection's group following
 *  the pyramid and the classification's the cut's mask (`GpuPartition.beginFrame`). */
export function beginPartitionFrame(
  p: Partition,
  encoder: GPUCommandEncoder,
  frame: PartitionFrame,
) {
  if (p.disposed) return
  const { allocated, forgotten, kept, buffers, inputs } = p
  const rowBytes = ROW_DATA_U32 * 4
  // Zero words are a row never projected, an occluder, of the occluder half: a row reused forgets
  // its rectangle, and in the copies a frozen cut kept its verdict and its half — a whole word of
  // rest bits, its neighbours drawn as occluders until the cut follows again.
  for (let i = 0; i < forgotten.length; i += 2) {
    const from = forgotten[i],
      to = Math.min(forgotten[i + 1], allocated.rows - 1)
    if (to < from) continue
    encoder.clearBuffer(allocated.rowData, from * rowBytes, (to - from + 1) * rowBytes)
    p.heldFlags.clear(encoder, from * 4, (to - from + 1) * 4)
    p.heldRest.clear(encoder, (from >> 5) * 4, ((to >> 5) - (from >> 5) + 1) * 4)
  }
  forgotten.length = 0
  p.cull = frame.cull
  if (frame.cull === 'follow') {
    p.heldFlags.drop()
    p.heldRest.drop()
  }
  // A frozen cut draws again what it kept from the buffers in place; else it tests, and keeps.
  p.held =
    frame.cull === 'held' &&
    p.heldFlags.restore(encoder, inputs.flags) &&
    p.heldRest.restore(encoder, inputs.restBits)
  const pyramid = inputs.pyramid()
  // Kept only once tested: an image without a pyramid tests nothing.
  p.keepDue = frame.cull === 'held' && !p.held && !!pyramid
  // A frame without a pyramid runs no kernel: it counts nothing, and its sample waits. A held one
  // neither, nor writes its uniform or the frame the audit reads: they stay the frozen image's.
  p.running = !!pyramid && !p.held
  p.counting = p.running && frame.counting
  if (!pyramid || p.held) return
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
  // The classification follows the cut's mask, remade when its buffer moved.
  const mask = frame.selection?.maskBuffer ?? buffers.items
  if (mask !== buffers.selectionMask) {
    buffers.selectionMask = mask
    const layout = p.layouts[CLASSIFY]
    p.groups[CLASSIFY] = createGpuPartitionGroup(p.device, layout, 'classifyRows', buffers)
  }
}

/** The verdicts and rest bits this image tested kept aside, on the first image of a frozen cut, once
 *  its occlusion test ran (`GpuPartition.keepVerdicts`). */
export function keepPartitionVerdicts(p: Partition, encoder: GPUCommandEncoder) {
  if (p.disposed || !p.keepDue) return
  p.heldFlags.keep(encoder, p.inputs.flags)
  p.heldRest.keep(encoder, p.inputs.restBits)
  p.keepDue = false
}

/** The partition's dispatches in the frame's compute pass (`GpuPartition.encode`). */
export function encodePartition(p: Partition, open: OpenPass) {
  if (p.disposed || !p.running) return
  // Nothing is held from frame to frame but the history, which lives in `rowData`:
  // counters and rest bits start from zero, cleared by the pass's first
  // dispatch; then each row is projected, then classified.
  const pass = open.pass,
    rows = p.kept.rows,
    rowGroups = workgroupCount(rows, WORKGROUP_THREADS)
  const clearThreads = partitionClearThreads(rows)
  const clearGroups = ceilDiv(clearThreads, WORKGROUP_THREADS)
  for (let k = 0; k < KERNELS.length; k++) {
    pass.setPipeline(p.pipelines[k])
    pass.setBindGroup(0, p.groups[k])
    dispatchRows(pass, k === CLEAR ? clearGroups : rowGroups)
  }
}
