import type { TransformTree } from './transformTree.ts'

/**
 * The children lists of a transform tree: each node links its first and last child, each child its
 * siblings. Attaching, detaching and stepping cost O(1); a subtree walk costs its own size, however
 * many other nodes share the tree.
 */

/** Hangs a parentless `node` last under `parent` (`-1`: stays a root), its subtree's depths
 *  following it (`hangDepths`). */
export function linkTransformNode(tree: TransformTree, node: number, parent: number) {
  tree.parent[node] = parent
  tree.nextSibling[node] = -1
  hangDepths(tree, node)
  if (parent < 0) return void (tree.previousSibling[node] = -1)
  const last = tree.lastChild[parent]
  tree.previousSibling[node] = last
  if (last < 0) tree.firstChild[parent] = node
  else tree.nextSibling[last] = node
  tree.lastChild[parent] = node
}

/** Takes `node` off its parent's children; it becomes a root. */
export function unlinkTransformNode(tree: TransformTree, node: number) {
  const parent = tree.parent[node]
  if (parent < 0) return
  const previous = tree.previousSibling[node],
    next = tree.nextSibling[node]
  if (previous < 0) tree.firstChild[parent] = next
  else tree.nextSibling[previous] = next
  if (next < 0) tree.lastChild[parent] = previous
  else tree.previousSibling[next] = previous
  tree.parent[node] = -1
}

/** The node after `node` in a parents-first walk of `top`'s subtree, −1 once it is done. */
export function nextInSubtree(tree: TransformTree, node: number, top: number) {
  const first = tree.firstChild[node]
  if (first >= 0) return first
  while (node !== top) {
    const next = tree.nextSibling[node]
    if (next >= 0) return next
    node = tree.parent[node]
  }
  return -1
}

/** The depths of `node`'s subtree, from its parent's: each node one deeper than its parent, what
 *  the frame pass orders parents before children by. */
export function hangDepths(tree: TransformTree, node: number) {
  const { depth, parent } = tree
  depth[node] = parent[node] < 0 ? 0 : depth[parent[node]] + 1
  for (let j = nextInSubtree(tree, node, node); j >= 0; j = nextInSubtree(tree, j, node))
    depth[j] = depth[parent[j]] + 1
}
