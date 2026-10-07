// The bounds the CPU cut's whole-subtree accept reads (`nodeDecision.fixture.ts`) beside those the
// GPU cut reads (`./bounds.ts`): the CEILING of own error and the FLOOR of the stand-ins' error.
// A ceiling under the threshold holds for every cluster of the subtree, a floor above it too, so a
// node whose two bounds agree takes every cluster under it, as the descent would have.
import { BOUND_STRIDE, cullingBounds } from './bounds.ts'
import type { ClusterCut } from '../selection/math.ts'

/** The production layout, then the two bounds the accept reads. */
export const SUBTREE_STRIDE = BOUND_STRIDE + 2
export const OWN_CEIL = BOUND_STRIDE,
  PARENT_FLOOR = BOUND_STRIDE + 1

/** Folds a cluster's own-error ceiling and replacement floor into its leaf node's. */
function foldPage(values: Float64Array, at: number, rec: ClusterCut) {
  const own = rec.lodError
  // Cluster with no error band: the node no longer certifies an accept.
  if (own === undefined || own === null) values[at + OWN_CEIL] = Infinity
  // A finite error without a sphere projects to infinity: the ceiling must say so.
  else if (own > 0 && !rec.sphere) values[at + OWN_CEIL] = Infinity
  else if (own > values[at + OWN_CEIL]) values[at + OWN_CEIL] = own
  // A cluster that nothing replaces projects to infinity: it lowers no floor.
  const parent = rec.parentError
  if (parent === undefined || parent === null || !Number.isFinite(parent)) return
  if (parent < values[at + PARENT_FLOOR]) values[at + PARENT_FLOOR] = parent
}

/**
 * Bounds of each node, `SUBTREE_STRIDE` numbers per node: `cullingBounds`' first, then the
 * ceiling and the floor, rolled up by the same downward sweep — a node's children are always
 * packed after it.
 */
export function subtreeBounds(
  culling: { nodes: Float64Array; stride: number },
  pages: readonly ClusterCut[],
) {
  const { nodes, stride } = culling,
    shared = cullingBounds(culling, pages),
    count = (nodes.length / stride) | 0,
    values = new Float64Array(count * SUBTREE_STRIDE)
  for (let node = count - 1; node >= 0; node--) {
    const base = node * stride,
      at = node * SUBTREE_STRIDE
    values.set(shared.subarray(node * BOUND_STRIDE, (node + 1) * BOUND_STRIDE), at)
    values[at + OWN_CEIL] = 0
    values[at + PARENT_FLOOR] = Infinity
    const children = nodes[base + 12]
    for (let child = 0; child < children; child++) {
      const from = (nodes[base + 11] + child) * SUBTREE_STRIDE
      if (values[from + OWN_CEIL] > values[at + OWN_CEIL])
        values[at + OWN_CEIL] = values[from + OWN_CEIL]
      if (values[from + PARENT_FLOOR] < values[at + PARENT_FLOOR])
        values[at + PARENT_FLOOR] = values[from + PARENT_FLOOR]
    }
    if (children > 0) continue
    const firstPage = nodes[base + 13],
      pageCount = nodes[base + 14]
    for (let i = 0; i < pageCount; i++) foldPage(values, at, pages[firstPage + i])
  }
  return values
}

const derived = new WeakMap<Float64Array, Float64Array>()

/** `subtreeBounds` once per node array: a placement copies the envelope, never the pages
 *  (`../../gpu/dag/packNodes.ts`, `cullingBoundsFor`). */
export function subtreeBoundsOf(
  culling: { nodes: Float64Array; stride: number },
  pages: readonly ClusterCut[],
) {
  let values = derived.get(culling.nodes)
  if (!values) derived.set(culling.nodes, (values = subtreeBounds(culling, pages)))
  return values
}
