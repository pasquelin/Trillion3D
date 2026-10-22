import {
  CULL_CEIL,
  CULL_CHILD_COUNT,
  CULL_FIRST_CHILD,
  CULL_FIRST_PAGE,
  CULL_FLOOR,
  CULL_MAX,
  CULL_MIN,
  CULL_PAGE_COUNT,
  CULL_SPHERE,
  CULL_STRIDE,
  DAG_NODE_FLOATS,
} from '../types.ts'
import type { Culling } from './packRoots.ts'
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
  NODE_FLOOR,
  NODE_OPEN,
  NODE_KIND,
  NODE_PAD,
} from '../nodeLayout.ts'

/**
 * The cut node as the GPU reads it: the manifest's node (`page-codec-wasm/src/culling.rs`) — its
 * box, its LOD ball, its replacement error ceiling and its least own error, both bounds of its
 * subtree, and its links — and the node's OPEN count: the clusters under it whose finer group is
 * not resident, the only ones the cut rule may draw above the threshold. Packing writes the DAG's
 * own count with nothing resident (`open`, `baseOpen`), so the table the cut uploads at creation
 * is already the one the rule reads; the kernel's host keeps it from then on (`../readiness.ts`),
 * and descent never drops an open leaf on its floor (`../shader/floorWgsl.ts`).
 */

/**
 * Copies a primitive's nodes into the GPU array — once, every placement of the primitive reading
 * them —, each node's first page counted from `place.pageBase` (zero: the primitive's own first
 * page, which a placement's entry adds its base to), and returns, per cluster, the leaf node that
 * owns it. `owner` is filled in place; a cluster no leaf stores stays at
 * `NO_INDEX`, as in the oracle (`oracle/*.fixture.ts`), and is never selected. `open`, the
 * DAG's open count of each node with nothing resident; zero without a structure. `grow`, the
 * distance a displaced surface of the primitive can move a point (`pagesDisplacementReach`), is
 * added to every side of each node's box and to no ball: what the cut tests the node's presence by
 * holds the displaced points, the error it projects is the surface's own.
 */
export function packCullingNodes(
  nodes: Float32Array,
  nodeInts: Uint32Array,
  culling: Culling,
  place: { nodeBase: number; pageBase: number },
  owner: Uint32Array,
  open?: Int32Array,
  grow = 0,
) {
  if (culling.stride < CULL_STRIDE) throw new Error('GPU_DAG_CULLING_STRIDE')
  const { nodeBase, pageBase } = place
  const count = culling.nodes.length / culling.stride
  for (let n = 0; n < count; n++) {
    const src = n * culling.stride,
      dst = (nodeBase + n) * DAG_NODE_FLOATS
    for (let a = 0; a < 3; a++) {
      nodes[dst + NODE_MIN + a] = culling.nodes[src + CULL_MIN + a] - grow
      nodes[dst + NODE_MAX + a] = culling.nodes[src + CULL_MAX + a] + grow
    }
    for (let a = 0; a < 4; a++) nodes[dst + NODE_SPHERE + a] = culling.nodes[src + CULL_SPHERE + a]
    nodes[dst + NODE_CEIL] = culling.nodes[src + CULL_CEIL]
    nodes[dst + NODE_FLOOR] = culling.nodes[src + CULL_FLOOR]
    nodeInts[dst + NODE_FIRST_CHILD] = nodeBase + culling.nodes[src + CULL_FIRST_CHILD]
    nodeInts[dst + NODE_CHILD_COUNT] = culling.nodes[src + CULL_CHILD_COUNT]
    nodeInts[dst + NODE_FIRST_PAGE] = pageBase + culling.nodes[src + CULL_FIRST_PAGE]
    nodeInts[dst + NODE_PAGE_COUNT] = culling.nodes[src + CULL_PAGE_COUNT]
    // No placement of its own: a queue entry names the placement that reads it.
    nodeInts[dst + NODE_WORLD] = 0
    nodeInts[dst + NODE_OPEN] = open ? open[n] : 0
    nodeInts[dst + NODE_KIND] = 0
    nodeInts[dst + NODE_PAD] = 0
    if (!culling.nodes[src + CULL_CHILD_COUNT]) {
      const first = culling.nodes[src + CULL_FIRST_PAGE],
        pages = culling.nodes[src + CULL_PAGE_COUNT]
      for (let i = 0; i < pages && first + i < owner.length; i++) owner[first + i] = nodeBase + n
    }
  }
  return count
}
