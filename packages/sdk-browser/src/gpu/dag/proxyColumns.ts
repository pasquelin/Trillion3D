/**
 * THE MESHES' COLUMNS IN THE PROXY'S ARENA (`proxyArena.ts`): a mesh's proxy — its triangles,
 * bounds, children and deformation corners — uploaded once, the first time a placement or a copy
 * wears it (`place`), into spans of the arena's tables, which lay the arena out again when they
 * cannot hold them (`taken`).
 */
import {
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
  PROXY_TRIANGLE_FLOATS,
} from '../../../../sdk-core/src/contracts/writtenFormats.ts'
import type { RuntimeCutProxy } from '../../../../sdk-core/src/contracts/proxy.ts'
import type { ProxyArena } from './proxyArena.ts'

/** Where a proxy lies in the arena: its first node and triangle, and what it holds. */
export type Placed = {
  node: number
  triangle: number
  nodes: number
  triangles: number
  /** A mesh that deforms: where its corner table lies among the corner words, and how many. */
  corner?: number
  corners: number
}

/** The columns of the meshes `arena` holds. */
export function createProxyColumns(arena: ProxyArena) {
  const cuts = new Map<RuntimeCutProxy, Placed>(),
    { triangles, nodes, corners } = arena.spans,
    { byteAt, send, relayout } = arena
  /** `count` units of each table taken, the tables laid out again when one cannot hold them: the
   *  spans, or none where the arena cannot be made larger (the engine's own refusal says why). */
  function taken(triangleCount: number, nodeCount: number, cornerCount = 0) {
    const take = () => [
      triangles.take(triangleCount),
      nodes.take(nodeCount),
      corners.take(cornerCount),
    ]
    let [triangle, node, corner] = take()
    if (triangle === undefined || node === undefined || corner === undefined) {
      if (triangle !== undefined) triangles.release(triangle, triangleCount)
      if (node !== undefined) nodes.release(node, nodeCount)
      if (corner !== undefined) corners.release(corner, cornerCount)
      relayout({
        triangles: triangles.extent + triangleCount,
        nodes: nodes.extent + nodeCount,
        corners: corners.extent + cornerCount,
      })
      ;[triangle, node, corner] = take()
    }
    return triangle === undefined || node === undefined || corner === undefined
      ? undefined
      : { triangle, node, corner }
  }

  /** `cut`'s triangles, bounds and children sent to the arena from `triangle` and `node`. */
  function uploadColumns(cut: RuntimeCutProxy, triangle: number, node: number) {
    const target = arena.made(),
      { layout } = arena
    send(target, byteAt(layout.triangles + triangle * PROXY_TRIANGLE_FLOATS), cut.triangles)
    send(target, byteAt(layout.bounds + node * PROXY_NODE_FLOATS), cut.nodeBounds)
    send(target, byteAt(layout.children + node * PROXY_NODE_WORDS), cut.nodeChildren)
    return target
  }

  /** A mesh's columns in the arena, uploaded the first time a placement wears it. */
  function place(cut: RuntimeCutProxy): Placed | undefined {
    const known = cuts.get(cut)
    if (known) return known
    const triangleCount = cut.triangles.length / PROXY_TRIANGLE_FLOATS,
      nodeCount = cut.nodeBounds.length / PROXY_NODE_FLOATS,
      cornerCount = cut.deform?.corners.length ?? 0
    if (!triangleCount || !nodeCount) return undefined
    const got = taken(triangleCount, nodeCount, cornerCount)
    if (!got) return undefined
    const { triangle, node, corner } = got
    const target = uploadColumns(cut, triangle, node)
    if (cut.deform) send(target, byteAt(arena.layout.deform + corner), cut.deform.corners)
    const placed: Placed = {
      node,
      triangle,
      nodes: nodeCount,
      triangles: triangleCount,
      corners: cornerCount,
    }
    if (cut.deform) placed.corner = corner
    cuts.set(cut, placed)
    return placed
  }

  return {
    /** Whether a mesh's columns were placed: the buffer is then made at the first write. */
    get placing() {
      return cuts.size > 0
    },
    taken,
    uploadColumns,
    place,
    /** The spans `taken` gave, back. */
    release(triangle: number, triangleCount: number, node: number, nodeCount: number) {
      triangles.release(triangle, triangleCount)
      nodes.release(node, nodeCount)
    },
  }
}
export type ProxyColumns = ReturnType<typeof createProxyColumns>
