import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'

/** The stage's buffers, refilled each image: the compute keeps its own copy when it binds them. */
const buffers: (GPUBuffer | GPUTextureView)[] = []
/** One deformation stage per image command buffer, before selection, shadows or raster. */
export function encodeDeformation(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu, vis } = rt
  if (!vis.deformationCompute) return
  const { cache, device } = gpu
  if (!cache || !device || !vis.concatPos || !vis.concatNrm || !vis.concatUv || !vis.pageTable)
    return
  buffers[0] = cache.buffer
  buffers[1] = vis.concatPos
  buffers[2] = vis.concatNrm // the normal atlas's view
  buffers[3] = vis.pageTable
  buffers[4] = vis.concatUv
  vis.deformationCompute.encode(
    encoder,
    buffers,
    rt.layout.rows.casterSlots,
    rt.run.frame,
    vis.wholeDeformation,
  )
}
