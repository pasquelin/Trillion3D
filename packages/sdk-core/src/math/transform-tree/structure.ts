import { EngineError } from '../../contracts/cache.ts';
import { NODE_ALIVE, NODE_LOCAL_CHANGED, assertNode, type TransformTree } from './transformTree.ts';

/**
 * Hierarchy structure: update order, removal, reparenting. The order places each parent
 * before its children; it is rebuilt lazily, once, at the first update that follows
 * a structure change — never per frame as long as the structure does not move.
 */

/**
 * Rebuilds the order if the structure has changed. When every parent has a lower index than its
 * children — the case of a scene loaded parent-first — the order is that of the indices, contiguous
 * in memory; otherwise a depth sort, stable by index.
 */
export function ensureOrder(tree: TransformTree) {
  if (!tree.orderDirty) return;
  const { parent, flags, depth, chain, buckets, order, orderAt, end } = tree;
  depth.fill(-1, 0, end);
  let monotone = true,
    deepest = 0,
    count = 0;
  for (let i = 0; i < end; i++) {
    if (!(flags[i] & NODE_ALIVE)) continue;
    count++;
    if (parent[i] > i) monotone = false;
    let links = 0,
      walk = i;
    while (walk >= 0 && depth[walk] < 0) {
      chain[links++] = walk;
      walk = parent[walk];
    }
    let level = walk < 0 ? -1 : depth[walk];
    while (links > 0) depth[chain[--links]] = ++level;
    if (level > deepest) deepest = level;
  }
  if (monotone) {
    let k = 0;
    for (let i = 0; i < end; i++) if (flags[i] & NODE_ALIVE) order[k++] = i;
  } else {
    buckets.fill(0, 0, deepest + 2);
    for (let i = 0; i < end; i++) if (flags[i] & NODE_ALIVE) buckets[depth[i] + 1]++;
    for (let d = 1; d <= deepest + 1; d++) buckets[d] += buckets[d - 1];
    for (let i = 0; i < end; i++) if (flags[i] & NODE_ALIVE) order[buckets[depth[i]]++] = i;
  }
  for (let k = 0; k < count; k++) orderAt[order[k]] = k;
  tree.orderCount = count;
  tree.orderDirty = false;
}

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
 * Calls `visit` on `node` then on each of its descendants, parents first. The per-frame
 * update keeps its own loop: an indirect call per node would cost there on a hundred thousand nodes.
 */
export function visitSubtree(
  tree: TransformTree,
  node: number,
  visit: (tree: TransformTree, node: number) => void,
) {
  ensureOrder(tree);
  const { order, parent, stamp } = tree;
  // Even, like the update stamps: a traversal never rereads another's.
  const mark = nextStamp(tree) * 2;
  stamp[node] = mark;
  visit(tree, node);
  for (let k = tree.orderAt[node] + 1; k < tree.orderCount; k++) {
    const j = order[k],
      p = parent[j];
    if (p < 0 || stamp[p] !== mark) continue;
    stamp[j] = mark;
    visit(tree, j);
  }
}

/**
 * Removes `node` and all its descendants; their indices will be reused. To detach a
 * subtree while keeping it, `reparentTransformNode(tree, node, -1)`.
 */
export function removeTransformNode(tree: TransformTree, node: number) {
  assertNode(tree, node);
  visitSubtree(tree, node, freeNode);
  tree.orderDirty = true;
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
  tree.parent[node] = parent;
  tree.flags[node] |= NODE_LOCAL_CHANGED;
  if (!tree.orderDirty && parent >= 0 && tree.orderAt[parent] > tree.orderAt[node])
    tree.orderDirty = true;
}
