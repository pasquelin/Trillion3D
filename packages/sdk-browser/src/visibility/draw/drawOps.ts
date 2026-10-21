import { DRAW_ITEM_U32, UNIFORM_BYTES } from './contract.ts'
import type { GpuDraw } from './contract.ts'
import type { OpenPass } from '../../gpu/core/lazyComputePass.ts'
import { createGpuDrawBuffers } from './buffers.ts'
import { constructGpuResources } from '../../gpu/core/errorScope.ts'
import { pendingBuffers } from '../../gpu/core/tableGrowth.ts'
import { writeChanged } from '../../gpu/core/writeChanged.ts'
import { workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { bufferEntries } from '../../gpu/core/computeBindings.ts'

type Held = ReturnType<typeof createGpuDrawBuffers>

/** A half's three kernels (`factory.ts`): both halves share one group layout. */
export type DrawKernels = {
  count: GPUComputePipeline
  prefix: GPUComputePipeline
  scatter: GPUComputePipeline
}

/** What the compact's methods share (`factory.ts`): the halves' layout and kernels, the row
 *  buffers held, the mask the groups bind, each half's group, and the uniform words. */
export type Draw = {
  device: GPUDevice
  slotCap: number
  layerSlots: number
  corners: number
  perRow: number
  layout: GPUBindGroupLayout
  main: DrawKernels
  post: DrawKernels
  held: Held
  boundMask: GPUBuffer
  /** The main half's group and the post half's, over `boundMask` and each its own uniform. */
  groups: { main: GPUBindGroup; post: GPUBindGroup }
  uniData: Uint32Array<ArrayBuffer>
  disposed: boolean
}

/** Both halves' groups on the buffers `held` and the draw mask `maskBuffer`: the same bindings
 *  but the uniform, the main half's or the post half's. */
export function drawBindGroups(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  held: Held,
  maskBuffer: GPUBuffer,
) {
  const { itemsBuf, uniforms, postUniforms, instanceBuffer, indirectBuffer, groups } = held
  const group = (uniform: GPUBuffer) =>
    device.createBindGroup({
      layout,
      entries: bufferEntries([
        itemsBuf,
        uniform,
        instanceBuffer,
        indirectBuffer,
        groups,
        maskBuffer,
      ]),
    })
  return { main: group(uniforms), post: group(postUniforms) }
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

/** The main half's count, prefix and scatter in the frame's compute pass (`GpuDraw.encode`). */
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
  // The `groups` regions' size, from the allocation's own formula (`drawGroupWords`).
  uniData[7] = held.groupEntries
  const mask = selection?.maskBuffer ?? held.itemsBuf
  if (mask !== d.boundMask) {
    d.boundMask = mask
    d.groups = drawBindGroups(d.device, d.layout, held, mask)
  }
  // Only the words that changed go up — most images change none; a grown table's new
  // buffer is held as its zeros (`writeChanged`).
  writeChanged(d.device, held.uniforms, uniData, 0, uniData.length)
  dispatchHalf(open.pass, d.main, d.groups.main, liveGroups)
}

/** The post half's words: the main half's, its selection the post mask's. */
const postUniData = new Uint32Array(UNIFORM_BYTES / 4)

/** The post half's count, prefix and scatter, once the cut's post pass wrote its mask
 *  (`GpuDraw.encodePost`): the items the main half counted, selected by the post mask, the word
 *  `postMaskOffset` of the mask buffer the main half bound. */
export function encodeDrawPost(d: Draw, open: OpenPass, postMaskOffset: number) {
  if (d.disposed) return
  postUniData.set(d.uniData)
  postUniData[5] = postMaskOffset
  writeChanged(d.device, d.held.postUniforms, postUniData, 0, postUniData.length)
  dispatchHalf(open.pass, d.post, d.groups.post, d.uniData[3])
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
    d.groups = drawBindGroups(device, d.layout, next, d.boundMask)
    return old.all
  })
}
