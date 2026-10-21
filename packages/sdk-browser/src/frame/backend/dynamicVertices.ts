import type { HostAttributes } from '../../session/host/resources.ts'
import type { VertexRange } from '../../placement/engineSceneUpdates.ts'
import { noteRewritten } from '../render/movedGeometry.ts'
import type { WebgpuPagesRuntime } from './runtime.ts'

/**
 * A dynamic geometry's rewrites on WebGPU. `updateVertices` writes its rewritten lists in place —
 * its block of the float vertex pool (`../../geometry/pages/pool/geometryPool.ts`), placed in the pool's room when a
 * record took it since the open —, then stales its shadow pages: no buffer allocated, no table
 * rebuilt; false when the device bounds the pool, and the owner opens the session again. A mount
 * past the room the open left grows the pool in place, so it never opens the session for it. Its
 * roots hold `reach`, how far a vertex moved from where its pages are bounded, and its pages' rows
 * the box `boxes` gives each (`noteRewritten`). `vertexBytes` weighs what that sends: each list in
 * the pool, a normal with its tangent.
 */
export const webgpuVertexApi = (rt: WebgpuPagesRuntime) => ({
  updateVertices(
    attributes: HostAttributes,
    ranges: readonly VertexRange[],
    box: Float64Array,
    reach: number,
    boxes?: Float64Array,
  ) {
    const { vis, gpu, run } = rt
    if (!gpu.device || run.lost) return false
    const pool = vis.vertexPool
    if (pool && !pool.place(attributes, true)) return false
    for (const { name, from, count } of ranges) pool?.write(attributes, name, from, count)
    noteRewritten(rt, attributes, box, reach, boxes)
    // A rewrite moves vertices, never a pose: the hierarchy keeps its matrices, so the next image
    // walks no world — the row table is kept. A host pose
    // write still unread stays owed (`engineWriting`) and is walked.
    run.gate.engineMovedInPlace()
    return true
  },
  vertexBytes: (attributes: HostAttributes, ranges: readonly VertexRange[]) =>
    rt.vis.vertexPool?.bytesOf(attributes, ranges) ?? 0,
})
