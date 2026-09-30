import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { followDirtyRows } from '../webgpu/pages/render/encodeDraws.ts';
import type { BufferRange } from '../webgpu/core/liveEntries.ts';

/** One deformation stage per image command buffer, before selection, shadows or raster. */
const encoded = new WeakSet<GPUCommandEncoder>();
/** The stage's buffers, refilled each image: the compute keeps its own copy when it binds them. */
const buffers: BufferRange[] = [];
export function encodeDeformation(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu, vis } = rt;
  if (!vis.deformationCompute || encoded.has(encoder)) return;
  const { cache, device } = gpu;
  if (!cache || !device || !vis.vertexPool || !vis.concatUv || !vis.pageTable) return;
  followDirtyRows(rt, device);
  buffers[0] = cache.buffer;
  // Two ranges of one buffer (#1410): the positions it writes, the normals it reads.
  buffers[1] = vis.vertexPool.positions;
  buffers[2] = vis.vertexPool.concatNrm;
  buffers[3] = vis.pageTable;
  buffers[4] = vis.concatUv;
  vis.deformationCompute.encode(
    encoder,
    buffers,
    rt.layout.rows.casterSlots,
    rt.run.frame,
    vis.wholeDeformation,
  );
  encoded.add(encoder);
}
