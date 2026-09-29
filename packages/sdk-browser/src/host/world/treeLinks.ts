import {
  addTransformNode,
  createTransformTree,
  markNodeWorldNeedsUpdate,
  type TransformTree,
} from '../../../../sdk-core/src/index.ts';
import { reparentTransformNode } from '../../../../sdk-core/src/math/transform-tree/structure.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

/** Nodes ranked parents before children, and each one's parent index (`-1` for the root). */
export function collect(source: Object3D) {
  const nodes: Object3D[] = [];
  for (let walk = source.parent; walk; walk = walk.parent) nodes.push(walk);
  nodes.reverse();
  // The reference's `traverse` is a prefix walk: a parent is always seen before its children.
  source.traverse((object) => nodes.push(object));
  const index = new Map<Object3D, number>();
  for (let rank = 0; rank < nodes.length; rank++) index.set(nodes[rank], rank);
  const parents = new Int32Array(nodes.length);
  for (let rank = 0; rank < nodes.length; rank++) parents[rank] = parentRank(nodes[rank], index);
  return { nodes, index, parents };
}

const parentRank = (node: Object3D, index: ReadonlyMap<Object3D, number>) =>
  node.parent ? (index.get(node.parent) ?? -1) : -1;

/** Engine tree mirroring the host structure: one node per host node, at the same rank. A parent
 *  a reparent ranked after its child is linked once both exist. */
export function socle(nodes: readonly Object3D[], parents: Int32Array) {
  const tree = createTransformTree(Math.max(1, nodes.length));
  for (let rank = 0; rank < nodes.length; rank++)
    addTransformNode(tree, parents[rank] < rank ? parents[rank] : -1);
  for (let rank = 0; rank < nodes.length; rank++)
    if (parents[rank] > rank) reparentTransformNode(tree, rank, parents[rank]);
  return tree;
}

/**
 * The host reparented or removed indexed nodes since the index read its links (#972): each node
 * whose host parent changed is linked again, in `parents` and in `tree` if built, to its new
 * parent's rank — `-1` when that parent lies outside the index —, its rank kept, so every world
 * view handed out stays its node's. The moved nodes are unlinked first, then linked: a swap of
 * parent and child never passes through a cycle. Returns false once a parent is ranked after its
 * child: the lot, which composes ranks in order, can no longer carry the index.
 */
export function relinkHostTree(
  tree: TransformTree | null,
  nodes: readonly Object3D[],
  index: ReadonlyMap<Object3D, number>,
  parents: Int32Array,
) {
  const moved: number[] = [];
  for (let rank = 0; rank < nodes.length; rank++)
    if (parentRank(nodes[rank], index) !== parents[rank]) moved.push(rank);
  if (tree) for (const rank of moved) reparentTransformNode(tree, rank, -1);
  let ordered = true;
  for (const rank of moved) {
    parents[rank] = parentRank(nodes[rank], index);
    if (!tree) continue;
    reparentTransformNode(tree, rank, parents[rank]);
    // A posed node is reached by no rule of its own: its new parent's world is read at the pass.
    markNodeWorldNeedsUpdate(tree, rank);
  }
  for (let rank = 0; rank < nodes.length && ordered; rank++) ordered = parents[rank] < rank;
  return ordered;
}
