import { EngineError } from '../../contracts/cache.ts';
import { NODE_LOCAL_CHANGED, assertNode, type TransformTree } from './transformTree.ts';
import { linkTransformNode, nextInSubtree, unlinkTransformNode } from './links.ts';

/**
 * Hierarchy structure: subtree walk, removal, release, reparenting. Every operation reads the
 * children lists (`links.ts`) and costs the subtree it touches, never the whole tree.
 */

/**
 * A fresh stamp for a subtree traversal, under 2³¹: the update doubles it and stores a
 * bit in it. Stamps are cleared on wrap-around.
 */
export function nextStamp(tree: TransformTree) {
  tree.call = (tree.call + 1) & 0x7fffffff;
  if (tree.call === 0) {
    tree.stamp.fill(0);
    tree.call = 1;
  }
  return tree.call;
}

/**
 * Calls `visit` on `node` then on each of its descendants, parents first, and returns how many it
 * visited. The per-frame update keeps its own loop: an indirect call per node would cost there on a
 * hundred thousand nodes.
 */
export function visitSubtree(
  tree: TransformTree,
  node: number,
  visit: (tree: TransformTree, node: number) => void,
) {
  let visited = 0;
  for (let j = node; j >= 0; j = nextInSubtree(tree, j, node), visited++) visit(tree, j);
  return visited;
}

/**
 * Removes `node` and all its descendants; their indices will be reused. To detach a
 * subtree while keeping it, `reparentTransformNode(tree, node, -1)`.
 */
export function removeTransformNode(tree: TransformTree, node: number) {
  assertNode(tree, node);
  unlinkTransformNode(tree, node);
  visitSubtree(tree, node, freeNode);
}

/**
 * Frees `node`'s slot alone, for an owner whose handle is gone (a collected scene object): it
 * leaves its parent, and its children become roots until their own release.
 */
export function releaseTransformNode(tree: TransformTree, node: number) {
  assertNode(tree, node);
  unlinkTransformNode(tree, node);
  for (let child = tree.firstChild[node]; child >= 0; child = tree.nextSibling[child]) {
    tree.parent[child] = -1;
    tree.flags[child] |= NODE_LOCAL_CHANGED;
  }
  freeNode(tree, node);
}

function freeNode(tree: TransformTree, node: number) {
  tree.flags[node] = 0;
  tree.free[tree.freeCount++] = node;
}

/**
 * Attaches `node` to `parent` (`-1`: root), like the reference `add`: matrices do not move
 * until the next update. Throws if `parent` is `node` or one of its descendants.
 */
export function reparentTransformNode(tree: TransformTree, node: number, parent: number) {
  assertNode(tree, node);
  if (parent !== -1) assertNode(tree, parent);
  for (let walk = parent; walk >= 0; walk = tree.parent[walk])
    if (walk === node)
      throw new EngineError('TRANSFORM_CYCLE', `node ${parent} under ${node}: cycle`, {
        node,
        parent,
      });
  if (tree.parent[node] === parent) return;
  unlinkTransformNode(tree, node);
  linkTransformNode(tree, node, parent);
  tree.flags[node] |= NODE_LOCAL_CHANGED;
}
