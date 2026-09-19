import {
  BOUND_STRIDE,
  cullingBounds,
  HAS_ROOT,
  OWN_FLOOR,
  OWN_SPHERE,
} from './pageSelectionCutBounds.ts';
import { CULL_STRIDE, DAG_NODE_FLOATS, type DagRoot } from './gpuDagTypes.ts';

/**
 * The cut node as the GPU reads it, and the subtree error FLOOR it now carries.
 *
 * The manifest only gives the node the replacement error CEILING: descent can
 * therefore only drop a too-fine subtree, and walks down to pages a too-coarse
 * subtree the cut will take nothing from. The floor — the smallest own error of
 * the subtree, with the sphere that encloses those it summarises — is the other
 * half, which the CPU cut already sets (`pageSelectionCutNode.ts`). `cullingBounds`
 * derives it from the pages at prepare: nothing from the compiler, nothing from
 * the page format.
 *
 * Four more words per node, sixteen floats become twenty-four: the floor sphere,
 * the floor itself, and a flags word whose only bit says whether the subtree
 * carries a cluster nothing replaces. `dagMask`'s pinned fallback draws those
 * clusters without consulting any threshold: descent must therefore never prune
 * them, whatever their error.
 */
/** Packed-node ranks, in the order `struct CullNode` of the shader declares them. Three
 *  readers reread them — the shader, the oracle (`gpuDagOracleMath.ts`) and frontier
 *  counting — and they are written only here: a moved field cannot leave a reader behind. */
export const NODE_MIN = 0,
  NODE_FIRST_CHILD = 3,
  NODE_MAX = 4,
  /** Replacement error ceiling of the subtree, -1 when the manifest does not carry one. */
  NODE_CEIL = 7,
  NODE_SPHERE = 8,
  NODE_WORLD = 12,
  NODE_FIRST_PAGE = 13,
  NODE_PAGE_COUNT = 14,
  NODE_CHILD_COUNT = 15,
  NODE_FLOOR_SPHERE = 16,
  NODE_FLOOR = 20,
  NODE_FLAGS = 21;
/** The two pad words that bring the node to ninety-six bytes, vec4-aligned. */
const NODE_PAD = 22;
/** Bit 0 of the node flags: the subtree carries a cluster nothing replaces. */
export const NODE_HAS_ROOT = 1;
/** Largest f32: the shader cannot write an infinite constant, and its floor reads
 *  this value where the CPU bound returns infinity. Both reject the same subtree. */
const INF32 = 3.4e38;

type Culling = NonNullable<DagRoot['culling']>;

/** Primitive bounds: those the host already derived, otherwise ours. The same
 *  node array always comes with the same pages — a placement copies the envelope,
 *  not the data — so the reduction is done once per array and recovered by identity. */
export function cullingBoundsFor(
  culling: Culling,
  pages: DagRoot['pages'],
  cache: Map<Float64Array, Float64Array>,
) {
  if (culling.bounds) return culling.bounds;
  let values = cache.get(culling.nodes);
  if (!values) {
    values = cullingBounds(culling, pages);
    cache.set(culling.nodes, values);
  }
  return values;
}

/**
 * Copies a primitive's nodes into the GPU array and returns, per cluster, the leaf
 * node that owns it. `owner` is filled in place; a cluster no leaf stores stays at
 * `SELECTION_NONE`, as for the CPU cut, and is never selected.
 */
export function packCullingNodes(
  nodes: Float32Array,
  nodeInts: Uint32Array,
  culling: Culling,
  bounds: Float64Array,
  place: { world: number; nodeBase: number; pageBase: number },
  owner: Uint32Array,
) {
  if (culling.stride < CULL_STRIDE) throw new Error('GPU_DAG_CULLING_STRIDE');
  const { world, nodeBase, pageBase } = place;
  const count = culling.nodes.length / culling.stride;
  if (bounds.length !== count * BOUND_STRIDE) throw new Error('GPU_DAG_CULLING_BOUNDS');
  for (let n = 0; n < count; n++) {
    const src = n * culling.stride,
      dst = (nodeBase + n) * DAG_NODE_FLOATS,
      at = n * BOUND_STRIDE;
    for (let a = 0; a < 3; a++) {
      nodes[dst + NODE_MIN + a] = culling.nodes[src + a];
      nodes[dst + NODE_MAX + a] = culling.nodes[src + 3 + a];
    }
    for (let a = 0; a < 4; a++) {
      nodes[dst + NODE_SPHERE + a] = culling.nodes[src + 6 + a];
      nodes[dst + NODE_FLOOR_SPHERE + a] = bounds[at + OWN_SPHERE + a];
    }
    nodes[dst + NODE_CEIL] = culling.nodes[src + 10];
    nodeInts[dst + NODE_FIRST_CHILD] = nodeBase + culling.nodes[src + 11];
    nodeInts[dst + NODE_CHILD_COUNT] = culling.nodes[src + 12];
    nodeInts[dst + NODE_FIRST_PAGE] = pageBase + culling.nodes[src + 13];
    nodeInts[dst + NODE_PAGE_COUNT] = culling.nodes[src + 14];
    nodeInts[dst + NODE_WORLD] = world;
    const floor = bounds[at + OWN_FLOOR];
    nodes[dst + NODE_FLOOR] = Number.isFinite(floor) ? floor : INF32;
    nodeInts[dst + NODE_FLAGS] = bounds[at + HAS_ROOT] ? NODE_HAS_ROOT : 0;
    nodeInts[dst + NODE_PAD] = 0;
    nodeInts[dst + NODE_PAD + 1] = 0;
    if (!culling.nodes[src + 12]) {
      const first = culling.nodes[src + 13],
        pages = culling.nodes[src + 14];
      for (let i = 0; i < pages && first + i < owner.length; i++) owner[first + i] = nodeBase + n;
    }
  }
  return count;
}
