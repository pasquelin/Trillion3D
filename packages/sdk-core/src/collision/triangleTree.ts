import { buildCentreTree, centreTreeNodes } from '../math/centreTree.ts'

/**
 * A STATIC TRIANGLE TREE: a bounding-volume hierarchy over triangles, built once and asked for
 * every triangle whose box meets a query box — the broad phase of a capsule — or for the nearest
 * one a ray crosses (`triangleQuery.ts`).
 *
 * BUILD. The shared median split over the triangles' centres (`../math/centreTree.ts`): a
 * balanced tree, so a query's stack is a fixed array. Triangles are then copied in leaf order: a
 * leaf reads a contiguous run, no index list survives.
 *
 * MEMORY. Exactly `36 T` bytes of triangles (nine float32) plus `32` bytes per node (six
 * float32 bounds, two int32 links), exactly `2 ceil(T / LEAF) - 1` nodes: about 52 bytes per
 * triangle. The build borrows `16 T` more bytes (order and centres), released when it returns.
 * `bytes` reports what the tree keeps.
 */

/** Most triangles a leaf holds. A leaf test costs a few dozen operations per triangle and a
 *  node test six comparisons, so a handful per leaf balances them; the value sets the cost of
 *  a query, never its result. */
const LEAF_TRIANGLES = 4

/** A bounding-volume hierarchy over world-space triangles, queried by box: the broad phase behind `triangleCollision` and `capsulePass`. Built once by `buildTriangleTree`, read-only afterwards. */
export interface TriangleTree {
  /** Nine numbers per triangle — three corners — in leaf order. */
  readonly triangles: Float32Array
  /** Per node: min xyz, max xyz. */
  readonly bounds: Float32Array
  /** Per node: first triangle of a leaf, or the right child of an inner node (the left one follows its parent). */
  readonly links: Int32Array
  /** Per node: triangle count of a leaf, 0 for an inner node. */
  readonly counts: Int32Array
  /** Triangles the tree holds. */
  readonly triangleCount: number
  /** Bytes the tree keeps. */
  readonly bytes: number
}

/** Builds the tree over `source`, nine numbers per triangle; the source is left untouched.
 *  `ranks`, when given, receives the rank in `source` of each triangle of the tree, in order. */
export function buildTriangleTree(source: ArrayLike<number>, ranks?: Uint32Array): TriangleTree {
  const count = Math.floor(source.length / 9)
  const capacity = centreTreeNodes(count, LEAF_TRIANGLES)
  const bounds = new Float32Array(capacity * 6),
    links = new Int32Array(capacity),
    counts = new Int32Array(capacity),
    order = new Uint32Array(count),
    centres = new Float32Array(count * 3)
  for (let t = 0; t < count; t++) {
    order[t] = t
    for (let k = 0; k < 3; k++)
      centres[3 * t + k] = (source[9 * t + k] + source[9 * t + 3 + k] + source[9 * t + 6 + k]) / 3
  }
  buildCentreTree(centres, order, count, LEAF_TRIANGLES, links, counts, (node, start, end) =>
    boxOf(bounds, node, source, order, start, end),
  )
  ranks?.set(order)
  const triangles = new Float32Array(count * 9)
  for (let i = 0; i < count; i++)
    for (let k = 0; k < 9; k++) triangles[9 * i + k] = source[9 * order[i] + k]
  const bytes = triangles.byteLength + bounds.byteLength + links.byteLength + counts.byteLength
  return { triangles, bounds, links, counts, triangleCount: count, bytes }
}

function boxOf(
  bounds: Float32Array,
  node: number,
  source: ArrayLike<number>,
  order: Uint32Array,
  start: number,
  end: number,
) {
  const at = node * 6
  bounds.fill(Infinity, at, at + 3)
  bounds.fill(-Infinity, at + 3, at + 6)
  for (let i = start; i < end; i++)
    for (let corner = 0; corner < 9; corner += 3)
      for (let k = 0; k < 3; k++) {
        const value = source[9 * order[i] + corner + k]
        if (value < bounds[at + k]) bounds[at + k] = value
        if (value > bounds[at + 3 + k]) bounds[at + 3 + k] = value
      }
}
