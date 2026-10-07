import { NODE_ALIVE, NODE_LISTED, type TransformTree } from './transformTree.ts'
import { nextStamp } from './structure.ts'
import { nextInSubtree } from './links.ts'
import { refreshNode } from './update.ts'

/**
 * THE FRAME PASS: one walk per frame over what changed, never over the tree.
 *
 * Every input change lists its node once (`markTransformNode`): a pose or matrix written, a parent
 * changed, a node added. The pass takes the listed nodes by depth, so a listed node comes after
 * every listed ancestor, and walks the subtree of each one no earlier walk of this pass covered:
 * each node is visited at most once, parents before children. A node outside every listed subtree
 * has no changed input and no ancestor with one: its world matrix is current already, so no
 * ancestor chain is climbed. A visited node is recalculated only when an input changed since its
 * last calculation (`refreshNode`), as the node update with `updateParents` and `updateChildren`
 * does (`updateNodeWorldMatrix`): the same composition and the same product in the same order,
 * hence the same bits, at the same instant. Nothing listed, nothing walked.
 */

/**
 * The listed nodes into `tree.order`, shallowest first (a counting sort on depth); how many. The
 * list is emptied: a write during the walk lists its node for the next pass.
 */
function byDepth(tree: TransformTree) {
  const { listed, depth, order } = tree,
    count = tree.listedCount
  let deepest = 0
  for (let i = 0; i < count; i++) deepest = Math.max(deepest, depth[listed[i]])
  if (tree.buckets.length < deepest + 2) tree.buckets = new Int32Array(2 * (deepest + 2))
  const buckets = tree.buckets
  buckets.fill(0, 0, deepest + 2)
  for (let i = 0; i < count; i++) buckets[depth[listed[i]] + 1]++
  for (let d = 1; d <= deepest; d++) buckets[d] += buckets[d - 1]
  for (let i = 0; i < count; i++) order[buckets[depth[listed[i]]]++] = listed[i]
  tree.listedCount = 0
  return count
}

/**
 * Brings the world matrix of every listed node and of every node under one up to date, each
 * once, parents first; returns how many nodes it visited. A freed slot still listed is skipped.
 * The stamp is odd, as a reached node's in `updateNodeMatrixWorld`, of a fresh traversal: no
 * earlier walk's stamp equals it.
 */
export function updateTransformTree(tree: TransformTree) {
  if (!tree.listedCount) return 0
  const count = byDepth(tree),
    { order, flags, stamp } = tree,
    walked = nextStamp(tree) * 2 + 1
  let visited = 0
  for (let k = 0; k < count; k++) {
    const node = order[k],
      bits = flags[node]
    flags[node] = bits & ~NODE_LISTED
    if (!(bits & NODE_ALIVE) || stamp[node] === walked) continue
    for (let j = node; j >= 0; j = nextInSubtree(tree, j, node), visited++) {
      refreshNode(tree, j, true)
      stamp[j] = walked
    }
  }
  return visited
}
