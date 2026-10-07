import { DRAW_ITEM_U32, WORKGROUP } from './contract.ts'
import type { GpuDraw } from './contract.ts'
import { createGpuDrawBuffers } from './buffers.ts'
import { constructGpuResources } from '../core/errorScope.ts'
import { pendingBuffers } from '../core/tableGrowth.ts'
import { vsmWriteChanged } from '../../vsm/writeChanged.ts'
import { workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { dispatchGrid } from '../dag/shader/gridWgsl.ts'

type Held = ReturnType<typeof createGpuDrawBuffers>

/** What the compact's methods share (`factory.ts`): its kernels, the row buffers held, the mask
 *  its group binds, its uniform words. */
export type Draw = {
  device: GPUDevice
  slotCap: number
  layerSlots: number
  corners: number
  perRow: number
  layout: GPUBindGroupLayout
  countPipeline: GPUComputePipeline
  prefixPipeline: GPUComputePipeline
  scatterPipeline: GPUComputePipeline
  held: Held
  boundMask: GPUBuffer
  bindGroup: GPUBindGroup
  uniData: Uint32Array<ArrayBuffer>
  disposed: boolean
}

/** The compact's group on the buffers `held`, the draw mask `maskBuffer`. */
export function drawBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  held: Held,
  maskBuffer: GPUBuffer,
) {
  const { itemsBuf, uniforms, instanceBuffer, indirectBuffer, groupCounts } = held
  const { groupOffsets, restBuf, slotUsedBuf } = held
  const bound = [itemsBuf, uniforms, instanceBuffer, indirectBuffer, groupCounts]
  bound.push(groupOffsets, maskBuffer, restBuf, slotUsedBuf)
  return device.createBindGroup({
    layout,
    entries: bound.map((buffer, binding) => ({ binding, resource: { buffer } })),
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

/** Count, prefix and scatter in the frame's compute pass (`GpuDraw.encode`). */
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
  const liveGroups = workgroupCount(n, WORKGROUP)
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
    d.bindGroup = drawBindGroup(d.device, d.layout, held, mask)
  }
  // Only the words that changed go up — most images change none; a grown table's new
  // buffer is held as its zeros (`vsmWriteChanged`).
  vsmWriteChanged(d.device, held.uniforms, uniData, 0, uniData.length)
  const pass = open.pass
  pass.setBindGroup(0, d.bindGroup)
  pass.setPipeline(d.countPipeline)
  // One workgroup per group of items: each lane reads its own item once (`countGroups`), in rows
  // past one dimension's groups (`flatGroup`).
  const [x, y] = dispatchGrid(liveGroups)
  pass.dispatchWorkgroups(x, y)
  pass.setPipeline(d.prefixPipeline)
  pass.dispatchWorkgroups(1)
  pass.setPipeline(d.scatterPipeline)
  pass.dispatchWorkgroups(x, y)
}

/** Row buffers for `rows` rows, put in place by the pending growth's commit (`GpuDraw.grow`). */
export function growDraw(d: Draw, rows: number) {
  const { device, layerSlots, perRow } = d
  const next = constructGpuResources(device, () =>
    createGpuDrawBuffers(device, rows, layerSlots, perRow),
  )
  return pendingBuffers(next.all, () => {
    const old = d.held
    d.held = next
    d.slotCap = rows
    if (d.boundMask === old.itemsBuf) d.boundMask = next.itemsBuf
    d.bindGroup = drawBindGroup(device, d.layout, next, d.boundMask)
    return old.all
  })
}
