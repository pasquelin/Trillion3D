import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { clampLowWins } from '../../../../math/src/scalar/reals.ts'
import { FINITE_SENTINEL } from '../../../../math/src/constants.ts'
import { mirrorKey } from '../../webgpu/cut/denseKeys.ts'
import { DAG_NODE_FLOATS, type PackedDag } from './types.ts'
import {
  NODE_CEIL,
  NODE_CHILD_COUNT,
  NODE_FIRST_CHILD,
  NODE_FLOOR,
  NODE_KIND,
  NODE_MAX,
  NODE_MIN,
  NODE_WORLD,
} from './nodeLayout.ts'
import {
  TREE_CELL,
  TREE_GROUP,
  TREE_SPAN,
  drawnAlways,
  treeNodeCount,
  type PlacementTree,
} from './placementTree.ts'
import { placementOrder } from './placementOrder.ts'

/** THE PLACEMENT TREE'S NODES AND MEMBERS WRITTEN (`placementTree.ts`): a full packing's, then the
 *  batches a growth appends in place. */

/** The tree's groups: its last level. */
const groupLevel = (tree: PlacementTree) => tree.levels[tree.levels.length - 1]

/** What the tree reads of the packing: each placement's mark and source. */
type TreeSource = Pick<PackedDag, 'mark' | 'worldSources'>

/** The members group `g` holds now: from its first, up to the live members. */
const groupMembers = (tree: PlacementTree, g: number) =>
  clampLowWins(tree.count - g * TREE_SPAN, 0, TREE_SPAN)

/**
 * Writes every tree node into `tree.nodes`: children, kind, the world it is read under (the
 * first), no error to prune by, its box open until the refit fits it. A cell's children
 * are every node of the level below it lays out; a group's, its live members. The list of members
 * drawn whatever the view starts as written whole (`treeTable.ts`).
 */
export function packPlacementTree(packed: TreeSource, tree: PlacementTree) {
  const nodeInts = new Uint32Array(tree.nodes.buffer, tree.nodes.byteOffset)
  tree.levels.forEach(({ base, count }, l) => {
    const below = tree.levels[l + 1]
    for (let j = 0; j < count; j++) {
      const at = (base + j) * DAG_NODE_FLOATS,
        first = j * TREE_SPAN
      nodeInts[at + NODE_FIRST_CHILD] = below ? below.base + first : first
      nodeInts[at + NODE_CHILD_COUNT] = below
        ? Math.min(TREE_SPAN, below.count - first)
        : groupMembers(tree, j)
      nodeInts[at + NODE_KIND] = below ? TREE_CELL : TREE_GROUP
      nodeInts[at + NODE_WORLD] = 0
      tree.nodes[at + NODE_CEIL] = -1
      tree.nodes[at + NODE_FLOOR] = 0
    }
  })
  // The boxes are the refit's (`treeRefit.ts`): every node holds the whole world until the first
  // cut fits it, over the leaves the GPU writes then.
  for (let k = 0; k < tree.count; k++) {
    const w = tree.order[k]
    if (drawnAlways(packed.mark[w])) mirrorKey(tree.always, w, true)
  }
  tree.always.moves.clear()
  for (let n = 0; n < treeNodeCount(tree); n++) wholeNode(tree.nodes, n)
}

/** Node `n` takes the box of the whole world, which no plane rejects: a node before its first fit. */
function wholeNode(nodes: Float32Array, n: number) {
  const at = n * DAG_NODE_FLOATS
  for (let a = 0; a < 3; a++) {
    nodes[at + NODE_MIN + a] = -FINITE_SENTINEL
    nodes[at + NODE_MAX + a] = FINITE_SENTINEL
  }
}

/** The member slot the next batch a growth appends starts at: the first of a new group, so no
 *  group holds placements of two batches. */
export const joinStart = (tree: PlacementTree) => ceilDiv(tree.count, TREE_SPAN) * TREE_SPAN

/**
 * Placements `batch`, appended to the packing in place, ordered as the full build orders its
 * members (`placementOrder`) and filling new groups from `joinStart`: each group's box covers its
 * own members alone. Their order words, slots and groups' member counts; returns the tree nodes
 * whose words changed — the new groups, their boxes left to the refit — and the member slots
 * taken, `[from, to)`, whose words the tree's table receives (`treeTable.ts`).
 */
export function joinPlacementTree(packed: TreeSource, tree: PlacementTree, batch: number[]) {
  const from = joinStart(tree)
  if (from + batch.length > tree.capacity) throw new Error('GPU_PLACEMENT_TREE_FULL')
  const order = placementOrder(packed.worldSources, batch),
    nodeInts = new Uint32Array(tree.nodes.buffer, tree.nodes.byteOffset)
  order.forEach((w, i) => {
    tree.order[from + i] = w
    tree.slot[w] = from + i
    if (drawnAlways(packed.mark[w])) mirrorKey(tree.always, w, true)
  })
  tree.count = from + batch.length
  const groups = groupLevel(tree).base,
    nodes: number[] = []
  for (let g = from / TREE_SPAN; g * TREE_SPAN < tree.count; g++) {
    nodeInts[(groups + g) * DAG_NODE_FLOATS + NODE_CHILD_COUNT] = groupMembers(tree, g)
    nodes.push(groups + g)
  }
  return { nodes: Int32Array.from(nodes), members: [from, tree.count] as const }
}
