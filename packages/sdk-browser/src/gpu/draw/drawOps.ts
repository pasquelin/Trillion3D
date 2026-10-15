import { DRAW_ITEM_U32 } from './contract.ts'
import type { GpuDraw } from './contract.ts'
import type { OpenPass } from '../core/lazyComputePass.ts'
import { createGpuDrawBuffers } from './buffers.ts'
import { constructGpuResources } from '../core/errorScope.ts'
import { pendingBuffers } from '../core/tableGrowth.ts'
import { writeChanged } from '../core/writeChanged.ts'
import { workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../dispatch/grid.ts'
import { bufferEntries } from '../core/computeBindings.ts'

type Held = ReturnType<typeof createGpuDrawBuffers>

/** A half's three kernels and their group layout (`factory.ts`). */
export type DrawKernels = {
  layout: GPUBindGroupLayout
  count: GPUComputePipeline
  prefix: GPUComputePipeline
  scatter: GPUComputePipeline
}

/** What the compact's methods share (`factory.ts`): each half's kernels, the row buffers held,
 *  the mask its groups bind, the tested half's group and what it binds, its uniform words. */
export type Draw = {
  device: GPUDevice
  slotCap: number
  layerSlots: number
  corners: number
  perRow: number
  occluders: DrawKernels
  tested: DrawKernels
  held: Held
  boundMask: GPUBuffer
  bindGroup: GPUBindGroup
  /** The tested half's group, over `boundMask`, the page table and the Hi-Z verdicts it names. */
  testedGroup: GPUBindGroup | undefined
  testedBound: readonly GPUBuffer[]
  uniData: Uint32Array<ArrayBuffer>
  disposed: boolean
}

/** A half's group on the buffers `held`, the draw mask `maskBuffer`, and the tested half's
 *  `verdicts`: the page table and the Hi-Z flags. */
export function drawBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  held: Held,
  maskBuffer: GPUBuffer,
  verdicts: readonly GPUBuffer[] = [],
) {
  const { itemsBuf, uniforms, instanceBuffer, indirectBuffer, groupCounts } = held
  const { groupOffsets, restBuf, slotTotals } = held
  const bound = [itemsBuf, uniforms, instanceBuffer, indirectBuffer, groupCounts]
  bound.push(groupOffsets, maskBuffer, restBuf, slotTotals, ...verdicts)
  return device.createBindGroup({
    layout,
    entries: bufferEntries(bound),
  })
}

/** Items `[from, to]` sent, within the slots (`GpuDraw.uploadItems`). */
export function uploadDrawItems(d: Draw, items: Uint32Array, from: number, to: number) {
  const last = Math.min(to, d.slotCap - 1)
  if (d.disposed || last < from) return
  const at = from * DRAW_ITEM_U32 * 4
  const bytes = (last - from + 1) * DRAW_ITEM_U32 * 4
  const { buffer, byteOffset } = items
  d.device.queue.writeBuffer(d.held.itemsBuf, at, buffer as ArrayBuffer, byteOffset + at, bytes)
}

/** The occluder half's count, prefix and scatter in the frame's compute pass (`GpuDraw.encode`). */
export function encodeDraw(
  d: Draw,
  open: Parameters<GpuDraw['encode']>[0],
  count: number,
  selection?: { maskBuffer: GPUBuffer; maskOffset: number },
) {
  if (d.disposed) return
  const { uniData, held } = d
  const n = Math.min(count, d.slotCap)
  // Only the groups the frame's items reach are counted and prefixed. The groups past them hold
  // zero by construction and nothing reads them, so bounding the serial prefix by the live count
  // is exact.
  const liveGroups = workgroupCount(n, WORKGROUP_THREADS)
  uniData[0] = count
  uniData[1] = d.corners
  uniData[2] = d.slotCap
  uniData[3] = liveGroups
  uniData[4] = selection ? 1 : 0
  uniData[5] = selection?.maskOffset ?? 0
  uniData[6] = d.perRow
  const mask = selection?.maskBuffer ?? held.itemsBuf
  if (mask !== d.boundMask) {
    d.boundMask = mask
    d.bindGroup = drawBindGroup(d.device, d.occluders.layout, held, mask)
  }
  // Only the words that changed go up — most images change none; a grown table's new
  // buffer is held as its zeros (`writeChanged`).
  writeChanged(d.device, held.uniforms, uniData, 0, uniData.length)
  dispatchHalf(open.pass, d.occluders, d.bindGroup, liveGroups)
}

/** The tested half's count, prefix and scatter, after the Hi-Z test whose verdicts `flags` it reads
 *  through the page table `pages` (`GpuDraw.encodeTested`): the occluder half's uniform, the
 *  items it counted. */
export function encodeDrawTested(d: Draw, open: OpenPass, pages: GPUBuffer, flags: GPUBuffer) {
  if (d.disposed) return
  const bound = d.testedBound
  if (!d.testedGroup || bound[0] !== d.boundMask || bound[1] !== pages || bound[2] !== flags) {
    d.testedBound = [d.boundMask, pages, flags]
    d.testedGroup = drawBindGroup(d.device, d.tested.layout, d.held, d.boundMask, [pages, flags])
  }
  dispatchHalf(open.pass, d.tested, d.testedGroup, d.uniData[3])
}

/** One workgroup per group of items for the count and the scatter — each lane reads its own item
 *  once (`countGroups`) —, one for the prefix. */
function dispatchHalf(
  pass: GPUComputePassEncoder,
  kernels: DrawKernels,
  group: GPUBindGroup,
  liveGroups: number,
) {
  pass.setBindGroup(0, group)
  pass.setPipeline(kernels.count)
  dispatchRows(pass, liveGroups)
  pass.setPipeline(kernels.prefix)
  pass.dispatchWorkgroups(1)
  pass.setPipeline(kernels.scatter)
  dispatchRows(pass, liveGroups)
}

/** Row buffers for `rows` rows, put in place by the pending growth's commit (`GpuDraw.grow`). */
export function growDraw(d: Draw, rows: number) {
  const { device, layerSlots, perRow } = d
  const next = constructGpuResources(device, () =>
    createGpuDrawBuffers(device, rows, layerSlots, perRow),
  )
  return pendingBuffers(device, next.all, () => {
    const old = d.held
    d.held = next
    d.slotCap = rows
    if (d.boundMask === old.itemsBuf) d.boundMask = next.itemsBuf
    d.bindGroup = drawBindGroup(device, d.occluders.layout, next, d.boundMask)
    d.testedGroup = undefined
    return old.all
  })
}
