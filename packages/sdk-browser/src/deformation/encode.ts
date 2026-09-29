import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { followDirtyRows } from '../webgpu/pages/render/encodeDraws.ts';

/** One deformation stage per image command buffer, before selection, shadows or raster. */
const encoded = new WeakSet<GPUCommandEncoder>();
export function encodeDeformation(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu, vis } = rt;
  if (!vis.deformationCompute || encoded.has(encoder)) return;
  const { cache, device } = gpu;
  if (!cache || !device || !vis.concatPos || !vis.concatNrm || !vis.concatUv || !vis.pageTable)
    return;
  followDirtyRows(rt, device);
  vis.deformationCompute.encode(
    encoder,
    [cache.buffer, vis.concatPos, vis.concatNrm, vis.pageTable, vis.concatUv],
    rt.layout.rows.casterSlots,
    rt.run.frame,
  );
  encoded.add(encoder);
}
