import type { HostAttributes } from '../../host/resources.ts';
import type { VertexRange } from '../../placement/backendSceneUpdates.ts';
import { noteRewritten } from './render/movedBatch.ts';
import type { WebgpuPagesRuntime } from './runtime.ts';

/**
 * A dynamic geometry's rewritten lists, written in place (#573): its block of the float vertex
 * pool (`../core/geometryPrepare.ts`) — placed in the pool's room when a record took it since
 * the open —, the fallback draw's positions, then its shadow pages, and the next frame is drawn:
 * no buffer allocated, no table rebuilt. False when the pool has no room left for it: the owner
 * opens the session again.
 */
export function updateWebgpuVertices(
  rt: WebgpuPagesRuntime,
  attributes: HostAttributes,
  ranges: readonly VertexRange[],
  box: Float64Array,
) {
  const { vis, gpu, run } = rt;
  if (!gpu.device || run.lost) return false;
  const pool = vis.vertexPool;
  if (pool && !pool.place(attributes, true)) return false;
  const positions = gpu.positionBuffers.get(attributes),
    xyz = attributes.position?.array;
  for (const { name, from, count } of ranges) {
    pool?.write(attributes, name, from, count);
    if (name === 'position' && positions && xyz instanceof Float32Array)
      gpu.device.queue.writeBuffer(
        positions,
        from * 12,
        xyz as Float32Array<ArrayBuffer>,
        from * 3,
        count * 3,
      );
  }
  noteRewritten(rt, attributes, box);
  run.gate.sceneMoved();
  return true;
}

/** The bytes `updateWebgpuVertices` sends for `ranges` of `attributes` (#573): each list in the
 *  pool — a normal with its tangent, seven floats —, and the positions again, into the fallback
 *  draw's buffer. */
export function webgpuVertexBytes(
  rt: WebgpuPagesRuntime,
  attributes: HostAttributes,
  ranges: readonly VertexRange[],
) {
  let bytes = rt.vis.vertexPool?.bytesOf(attributes, ranges) ?? 0;
  if (rt.gpu.positionBuffers.has(attributes) && attributes.position?.array instanceof Float32Array)
    for (const { name, count } of ranges) if (name === 'position') bytes += count * 12;
  return bytes;
}

/** A session's rewrites of dynamic geometry in place (`RenderBackend.updateVertices`), on `rt`. */
export const webgpuVertexApi = (rt: WebgpuPagesRuntime) => ({
  updateVertices: (attributes: HostAttributes, ranges: readonly VertexRange[], box: Float64Array) =>
    updateWebgpuVertices(rt, attributes, ranges, box),
  vertexBytes: (attributes: HostAttributes, ranges: readonly VertexRange[]) =>
    webgpuVertexBytes(rt, attributes, ranges),
});
