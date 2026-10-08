import { sphereUnion } from '../../../../math/src/geometry/sphere.ts'
import type { ClusterCut } from '../selection/math.ts'

/**
 * Per-node bounds of the culling hierarchy, derived once from the clusters it packs.
 *
 * The manifest already carries, per node, the box, a bounding sphere and the subtree's maximum
 * replacement error: enough to reject a subtree whose no cluster still has a stand-in that is too
 * coarse, and nothing more. The GPU cut reads what the manifest does not carry: the floor of own
 * error with the sphere that bounds the clusters it summarises, which rejects a subtree too
 * coarse to give the cut anything (`../../gpu/dag/packNodes.ts`), and the sphere of the stand-ins'
 * bands with whether a cluster nothing replaces lies below, which a flat hierarchy's ceiling is
 * projected through (`../../gpu/dag/hierarchy.ts`). All are read from the pages: the reduction is
 * done here, at prepare time, once per primitive, without touching the manifest format.
 *
 * Monotonicity, the invariant: a node's bounds enclose those of all its descendants. A floor
 * above the threshold therefore holds for every cluster of the subtree, and the rejection taken
 * at the node is word for word the one the descent would have returned.
 */
export const BOUND_STRIDE = 10
export const OWN_FLOOR = 0,
  OWN_SPHERE = 1,
  PARENT_SPHERE = 5,
  /** 1 when the subtree carries a cluster that NOTHING replaces — the coarsest cover. Its
   *  replacement error projects to infinity, so no ceiling certifies the subtree
   *  (`../../gpu/dag/hierarchy.ts`). */
  HAS_ROOT = 9

/** Folds a cluster into the bounds of its leaf node. */
function foldPage(values: Float64Array, at: number, rec: ClusterCut) {
  const own = rec.lodError,
    sphere = rec.sphere
  // Cluster with no error band: the node no longer certifies a rejection.
  if (own === undefined || own === null) values[at + OWN_FLOOR] = 0
  else if (own < values[at + OWN_FLOOR]) values[at + OWN_FLOOR] = own
  if (sphere) sphereUnion(values, at + OWN_SPHERE, sphere, 0)
  // A cluster that nothing replaces projects to infinity: its band bounds nothing.
  const parent = rec.parentError
  if (parent === undefined || parent === null || !Number.isFinite(parent)) {
    values[at + HAS_ROOT] = 1
    return
  }
  const band = rec.parentSphere ?? sphere
  if (band) sphereUnion(values, at + PARENT_SPHERE, band, 0)
}

/** Folds a child node into its parent's bounds. */
function foldChild(values: Float64Array, at: number, from: number) {
  if (values[from + OWN_FLOOR] < values[at + OWN_FLOOR])
    values[at + OWN_FLOOR] = values[from + OWN_FLOOR]
  sphereUnion(values, at + OWN_SPHERE, values, from + OWN_SPHERE)
  sphereUnion(values, at + PARENT_SPHERE, values, from + PARENT_SPHERE)
  if (values[from + HAS_ROOT] === 1) values[at + HAS_ROOT] = 1
}

/**
 * Bounds of each node, `BOUND_STRIDE` numbers per node, computed once per primitive. A node's
 * children are always packed after it in the flat array: a single downward sweep is enough to
 * roll the bounds up.
 */
export function cullingBounds(
  { nodes, stride }: { nodes: Float64Array; stride: number },
  pages: readonly ClusterCut[],
) {
  const count = (nodes.length / stride) | 0
  const values = new Float64Array(count * BOUND_STRIDE)
  for (let node = count - 1; node >= 0; node--) {
    const base = node * stride,
      at = node * BOUND_STRIDE
    values[at + OWN_FLOOR] = Infinity
    values[at + OWN_SPHERE + 3] = -1
    values[at + PARENT_SPHERE + 3] = -1
    values[at + HAS_ROOT] = 0
    const children = nodes[base + 12]
    if (children > 0) {
      const first = nodes[base + 11]
      for (let child = 0; child < children; child++)
        foldChild(values, at, (first + child) * BOUND_STRIDE)
      continue
    }
    const firstPage = nodes[base + 13],
      pageCount = nodes[base + 14]
    for (let i = 0; i < pageCount; i++) foldPage(values, at, pages[firstPage + i])
  }
  return values
}
