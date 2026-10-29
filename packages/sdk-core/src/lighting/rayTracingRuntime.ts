import {
  RAY_TRACING_FLAG_ALL_TRANSLUCENT,
  RAY_TRACING_FLAG_ATTRIBUTES,
  RAY_TRACING_FLAG_NORMALS,
  RAY_TRACING_FLAG_TRANSLUCENT,
  RAY_TRACING_NODE_BYTES,
  RAY_TRACING_RECORD_AT,
  RAY_TRACING_TRIANGLE_BYTES,
} from '../contracts/rayTracingAbi.ts'
import {
  RAY_TRACING_CORNER_WORDS,
  RAY_TRACING_RECORD_WORDS,
  type RayTracing,
} from './rayTracingFile.ts'
import type { RayTracingTree } from './rayTracingTree.ts'

/**
 * THE RAY TRACING STRUCTURE OF A SCENE WITH MESHES CUT AT RUN TIME: the file the compiler wrote (`rayTracingFile.ts`), if the
 * scene has one, and after its records one more for each mesh a world cut at run time (`RuntimeTree`), laid out as the
 * compiler's records are, so that the one trace reads both. The new records name their primitive by the compiled mesh and primitive
 * numbers a placed root names it by (`ClusterRoot.mesh`, `ClusterRoot.primitive`), come after the world's directory and the actors' records
 * (whose ranks are the file's), and take the ranks of the nodes and the triangles after the file's. A world numbers its meshes once, the compiled
 * models' and the run-time ones' together (`session/world/ranks.ts`), so that no record is named twice; one that is is a `RangeError`, never a record
 * written over another. A run-time mesh is one
 * primitive of a mesh of its own: a translucent one is flagged translucent whole. Its records carry no corner attributes: the
 * file's table, if it has one, is extended with zeros for the run-time triangles.
 */

/** A mesh cut at run time and its tree: its mesh and primitive numbers, and the flags of its material (`RAY_TRACING_FLAG_*`, but the whole one). */
export interface RuntimeTree {
  readonly mesh: number
  readonly primitive: number
  readonly flags: number
  readonly tree: RayTracingTree
}

const NODE_WORDS = RAY_TRACING_NODE_BYTES / 4
const TRIANGLE_WORDS = RAY_TRACING_TRIANGLE_BYTES / 4

/** `file` with the records of `runtime` after its own; `file` itself where there are none. None where there is neither. */
export function withRuntimeTrees(
  file: RayTracing | undefined,
  runtime: readonly RuntimeTree[],
): RayTracing | undefined {
  if (runtime.length === 0) return file
  const own = {
    records: file?.records ?? new Uint32Array(0),
    nodes: file?.nodes ?? new Uint32Array(0),
    triangles: file?.triangles ?? new Uint32Array(0),
  }
  const records = new Uint32Array(own.records.length + runtime.length * RAY_TRACING_RECORD_WORDS)
  const nodes = new Uint32Array(
    own.nodes.length + runtime.reduce((n, { tree }) => n + tree.nodes.length, 0),
  )
  const triangles = new Uint32Array(
    own.triangles.length + runtime.reduce((n, { tree }) => n + tree.triangles.length, 0),
  )
  const corners = new Uint32Array(
    file?.corners.length ? (triangles.length / TRIANGLE_WORDS) * 3 * RAY_TRACING_CORNER_WORDS : 0,
  )
  corners.set(file?.corners ?? [])
  records.set(own.records)
  nodes.set(own.nodes)
  triangles.set(own.triangles)
  const floats = new Float32Array(records.buffer)
  const byPrimitive = new Map(
    [...(file?.byPrimitive ?? [])].map(([mesh, held]) => [mesh, new Map(held)]),
  )
  let [record, node, triangle] = [
    own.records.length / RAY_TRACING_RECORD_WORDS,
    own.nodes.length / NODE_WORDS,
    own.triangles.length / TRIANGLE_WORDS,
  ]
  const A = RAY_TRACING_RECORD_AT
  for (const { mesh, primitive, flags, tree } of runtime) {
    if (byPrimitive.get(mesh)?.has(primitive))
      throw new RangeError(
        `ray tracing: the run-time primitive ${mesh}/${primitive} is already a record of the scene`,
      )
    const at = record * RAY_TRACING_RECORD_WORDS
    const translucent = (flags & RAY_TRACING_FLAG_TRANSLUCENT) !== 0
    records[at + A.mesh] = mesh
    records[at + A.primitive] = primitive
    // A run-time mesh carries no corner attributes, whatever flags its caller passes.
    records[at + A.flags] =
      (flags & ~(RAY_TRACING_FLAG_ATTRIBUTES | RAY_TRACING_FLAG_NORMALS)) |
      (translucent ? RAY_TRACING_FLAG_ALL_TRANSLUCENT : 0)
    records[at + A.firstNode] = node
    records[at + A.nodeCount] = tree.nodes.length / NODE_WORDS
    records[at + A.firstTriangle] = triangle
    records[at + A.triangleCount] = tree.triangles.length / TRIANGLE_WORDS
    floats.set(tree.low, at + A.boxMin)
    floats.set(tree.high, at + A.boxMax)
    nodes.set(tree.nodes, node * NODE_WORDS)
    triangles.set(tree.triangles, triangle * TRIANGLE_WORDS)
    byPrimitive.set(mesh, (byPrimitive.get(mesh) ?? new Map()).set(primitive, record))
    record++
    node += tree.nodes.length / NODE_WORDS
    triangle += tree.triangles.length / TRIANGLE_WORDS
  }
  return {
    records,
    nodes,
    triangles,
    corners,
    byPrimitive,
    world: file?.world,
    actorCells: file?.actorCells ?? 0,
  }
}
