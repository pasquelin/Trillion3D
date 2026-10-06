import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { followDirtyRows } from '../webgpu/pages/render/encodeDraws.ts'

/** One deformation stage per image command buffer, before selection, shadows or raster. */
const encoded = new WeakSet<GPUCommandEncoder>()
/** The stage's buffers, refilled each image: the compute keeps its own copy when it binds them. */
const buffers: (GPUBuffer | GPUTextureView)[] = []
export function encodeDeformation(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu, vis } = rt
  if (!vis.deformationCompute || encoded.has(encoder)) return
  const { cache, device } = gpu
  if (!cache || !device || !vis.concatPos || !vis.concatNrm || !vis.concatUv || !vis.pageTable)
    return
  followDirtyRows(rt, device)
  buffers[0] = cache.buffer
  buffers[1] = vis.concatPos
  buffers[2] = vis.concatNrm // the normal atlas's view (#1410)
  buffers[3] = vis.pageTable
  buffers[4] = vis.concatUv
  vis.deformationCompute.encode(
    encoder,
    buffers,
    rt.layout.rows.casterSlots,
    rt.run.frame,
    vis.wholeDeformation,
  )
  encoded.add(encoder)
}
