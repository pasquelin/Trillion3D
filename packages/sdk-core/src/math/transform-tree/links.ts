import type { TransformTree } from './transformTree.ts';

/**
 * The children lists of a transform tree: each node links its first and last child, each child its
 * siblings. Attaching, detaching and stepping cost O(1); a subtree walk costs its own size, however
 * many other nodes share the tree.
 */

/** Hangs a parentless `node` last under `parent` (`-1`: stays a root). */
export function linkTransformNode(tree: TransformTree, node: number, parent: number) {
  tree.parent[node] = parent;
  tree.nextSibling[node] = -1;
  if (parent < 0) return void (tree.previousSibling[node] = -1);
  const last = tree.lastChild[parent];
  tree.previousSibling[node] = last;
  if (last < 0) tree.firstChild[parent] = node;
  else tree.nextSibling[last] = node;
  tree.lastChild[parent] = node;
}

/** Takes `node` off its parent's children; it becomes a root. */
export function unlinkTransformNode(tree: TransformTree, node: number) {
  const parent = tree.parent[node];
  if (parent < 0) return;
  const previous = tree.previousSibling[node],
    next = tree.nextSibling[node];
  if (previous < 0) tree.firstChild[parent] = next;
  else tree.nextSibling[previous] = next;
  if (next < 0) tree.lastChild[parent] = previous;
  else tree.previousSibling[next] = previous;
  tree.parent[node] = -1;
}

/** The node after `node` in a parents-first walk of `top`'s subtree, −1 once it is done. */
export function nextInSubtree(tree: TransformTree, node: number, top: number) {
  const first = tree.firstChild[node];
  if (first >= 0) return first;
  while (node !== top) {
    const next = tree.nextSibling[node];
    if (next >= 0) return next;
    node = tree.parent[node];
  }
  return -1;
}
