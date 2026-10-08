import { BOUND_STRIDE, cullingBounds, OWN_FLOOR, OWN_SPHERE } from '../../page/cut/bounds.ts'
import type { ClusterCut } from '../../page/selection/math.ts'
import { CULL_STRIDE, DAG_NODE_FLOATS, type DagRoot } from './types.ts'
import { FINITE_SENTINEL } from '../../../../math/src/constants.ts'
import {
  NODE_MIN,
  NODE_FIRST_CHILD,
  NODE_MAX,
  NODE_CEIL,
  NODE_SPHERE,
  NODE_WORLD,
  NODE_FIRST_PAGE,
  NODE_PAGE_COUNT,
  NODE_CHILD_COUNT,
  NODE_FLOOR_SPHERE,
  NODE_FLOOR,
  NODE_OPEN,
  NODE_KIND,
  NODE_PAD,
} from './nodeLayout.ts'

/**
 * The cut node as the GPU reads it, and the subtree error FLOOR it carries.
 *
 * The manifest only gives the node the replacement error CEILING: descent can
 * therefore only drop a too-fine subtree, and walks down to pages a too-coarse
 * subtree the cut will take nothing from. The floor — the smallest own error of
 * the subtree, with the sphere that encloses those it summarises — is the other
 * half, which the oracle sets too (`oracle/nodeVerdict.fixture.ts`). `cullingBounds`
 * derives it from the pages at prepare: nothing from the compiler, nothing from
 * the page format.
 *
 * Four more words per node, sixteen floats become twenty-four: the floor sphere,
 * the floor itself, and the node's OPEN count — the clusters under it whose finer group
 * is not resident, the only ones the cut rule may draw above the threshold. Packing
 * writes zero; the kernel's host keeps it (`readiness.ts`), and descent never drops an
 * open subtree on its floor.
 */

type Culling = NonNullable<DagRoot['culling']>

/** Primitive bounds: those the host already derived, otherwise ours. The same
 *  node array always comes with the same pages — a placement copies the envelope,
 *  not the data — so the reduction is done once per array and recovered by identity. */
export function cullingBoundsFor(
  culling: Culling,
  pages: readonly ClusterCut[],
  cache: Map<Float64Array, Float64Array>,
) {
  if (culling.bounds) return culling.bounds
  let values = cache.get(culling.nodes)
  if (!values) {
    values = cullingBounds(culling, pages)
    cache.set(culling.nodes, values)
  }
  return values
}

/**
 * Copies a primitive's nodes into the GPU array and returns, per cluster, the leaf
 * node that owns it. `owner` is filled in place; a cluster no leaf stores stays at
 * `SELECTION_NONE`, as in the oracle (`oracle/*.fixture.ts`), and is never selected.
 */
export function packCullingNodes(
  nodes: Float32Array,
  nodeInts: Uint32Array,
  culling: Culling,
  bounds: Float64Array,
  place: { world: number; nodeBase: number; pageBase: number },
  owner: Uint32Array,
) {
  if (culling.stride < CULL_STRIDE) throw new Error('GPU_DAG_CULLING_STRIDE')
  const { world, nodeBase, pageBase } = place
  const count = culling.nodes.length / culling.stride
  if (bounds.length !== count * BOUND_STRIDE) throw new Error('GPU_DAG_CULLING_BOUNDS')
  for (let n = 0; n < count; n++) {
    const src = n * culling.stride,
      dst = (nodeBase + n) * DAG_NODE_FLOATS,
      at = n * BOUND_STRIDE
    for (let a = 0; a < 3; a++) {
      nodes[dst + NODE_MIN + a] = culling.nodes[src + a]
      nodes[dst + NODE_MAX + a] = culling.nodes[src + 3 + a]
    }
    for (let a = 0; a < 4; a++) {
      nodes[dst + NODE_SPHERE + a] = culling.nodes[src + 6 + a]
      nodes[dst + NODE_FLOOR_SPHERE + a] = bounds[at + OWN_SPHERE + a]
    }
    nodes[dst + NODE_CEIL] = culling.nodes[src + 10]
    nodeInts[dst + NODE_FIRST_CHILD] = nodeBase + culling.nodes[src + 11]
    nodeInts[dst + NODE_CHILD_COUNT] = culling.nodes[src + 12]
    nodeInts[dst + NODE_FIRST_PAGE] = pageBase + culling.nodes[src + 13]
    nodeInts[dst + NODE_PAGE_COUNT] = culling.nodes[src + 14]
    nodeInts[dst + NODE_WORLD] = world
    const floor = bounds[at + OWN_FLOOR]
    // The shader cannot write an infinite constant: its floor reads `FINITE_SENTINEL` (its `INF`)
    // where the CPU bound returns infinity, and both reject the same subtree.
    nodes[dst + NODE_FLOOR] = Number.isFinite(floor) ? floor : FINITE_SENTINEL
    nodeInts[dst + NODE_OPEN] = 0
    nodeInts[dst + NODE_KIND] = 0
    nodeInts[dst + NODE_PAD] = 0
    if (!culling.nodes[src + 12]) {
      const first = culling.nodes[src + 13],
        pages = culling.nodes[src + 14]
      for (let i = 0; i < pages && first + i < owner.length; i++) owner[first + i] = nodeBase + n
    }
  }
  return count
}
