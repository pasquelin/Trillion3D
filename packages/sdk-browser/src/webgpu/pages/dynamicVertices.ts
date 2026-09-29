import type { HostAttributes } from '../../host/resources.ts';
import type { VertexRange } from '../../placement/backendSceneUpdates.ts';
import { noteRewritten } from './render/movedBatch.ts';
import type { WebgpuPagesRuntime } from './runtime.ts';

/**
 * A dynamic geometry's rewrites on WebGPU (#573). `updateVertices` writes its rewritten lists in
 * place — its block of the float vertex pool (`../core/geometryPrepare.ts`), placed in the pool's
 * room when a record took it since the open, the fallback draw's positions —, then stales its
 * shadow pages: no buffer allocated, no table rebuilt; false when the pool has no room left, and
 * the owner opens the session again. `vertexBytes` weighs what that sends: each list in the pool,
 * a normal with its tangent, and the positions again for the fallback draw.
 */
export const webgpuVertexApi = (rt: WebgpuPagesRuntime) => ({
  updateVertices(attributes: HostAttributes, ranges: readonly VertexRange[], box: Float64Array) {
    const { vis, gpu, run } = rt;
    if (!gpu.device || run.lost) return false;
    const pool = vis.vertexPool;
    if (pool && !pool.place(attributes, true)) return false;
    const positions = gpu.positionBuffers.get(attributes),
      xyz = attributes.position?.array as Float32Array<ArrayBuffer> | undefined;
    for (const { name, from, count } of ranges) {
      pool?.write(attributes, name, from, count);
      if (name === 'position' && positions && xyz instanceof Float32Array)
        gpu.device.queue.writeBuffer(positions, from * 12, xyz, from * 3, count * 3);
    }
    noteRewritten(rt, attributes, box);
    // A rewrite moves vertices, never a pose: the hierarchy keeps its matrices, so the next image
    // walks no world — the row table, its occluder history and its corners are kept. A host pose
    // write still unread stays owed (`engineWriting`) and is walked as before.
    run.gate.engineMovedInPlace();
    return true;
  },
  vertexBytes(attributes: HostAttributes, ranges: readonly VertexRange[]) {
    let bytes = rt.vis.vertexPool?.bytesOf(attributes, ranges) ?? 0;
    if (
      rt.gpu.positionBuffers.has(attributes) &&
      attributes.position?.array instanceof Float32Array
    )
      for (const { name, count } of ranges) if (name === 'position') bytes += count * 12;
    return bytes;
  },
});
