import {
  EngineError,
  HIERARCHY_ROOT,
  MATRIX_VALUES,
  POSITION_VALUES,
  QUATERNION_VALUES,
  addTransformNode,
  createTransformTree,
  updateNodeMatrixWorld,
  type TransformTree,
} from '../../../../sdk-core/src/index.ts';
import { pushHostPose } from './pose.ts';
import { createHierarchyLot, type HierarchyLot } from '../../math/batchHierarchy.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

/**
 * World matrices of a HOST SUBTREE, computed by the engine in ITS OWN transform tree.
 *
 * The index covers the subtree of `source` AND the ancestor chain of its root, parents before
 * children. The structure is read ONCE, when the index is built; after that the engine's tree
 * carries the hierarchy, and a pass writes only what moved. What that saves is PRODUCTS, not
 * reads: every pose is still read and compared at every pass, so on a scene of a few thousand
 * nodes the pass can cost MORE than the one that recomputed everything — only a measurement of
 * the frame says which way it went there.
 *
 * WHAT A PASS COSTS. Local poses are pushed into the tree number by number, and a number that
 * has not moved is not written: the node keeps its flags clean. `updateNodeMatrixWorld` is then
 * called WITHOUT `force`, so the tree's own rule — a node recomputes when one of its inputs
 * changed, or when its parent's world matrix was recomputed since — restricts the products to
 * the subtrees that actually moved. One node moved out of two thousand costs the chain under it,
 * not the scene. The formulas are unchanged: the same composition and the same product, in the
 * same order, hence the same bits as the pass that recomputed everything.
 *
 * TWO PATHS, ONE TRUTH. When the whole subtree recomposes its pose and a hierarchy lot carries
 * it exactly, the pass goes AS A LOT: poses are written into the arena buffers, the governor
 * chooses JavaScript or WebAssembly, and world matrices stay where the kernel wrote them —
 * nothing is copied, and views are rebuilt when the module memory has grown. Otherwise the pass
 * runs on the core tree, which accepts both a node that recomposes and a node whose host cut
 * recomposition.
 *
 * The engine keeps ITS copy: no host `matrixWorld` is written, nor even read.
 */

export interface HostWorldTree {
  /** Indexed nodes: the subtree, and the ancestors of its root. */
  readonly n: number;
  /** True when the last recompute went as a lot; false when it went through the tree. */
  readonly batched: boolean;
  /**
   * World matrix the ENGINE computed for `node`. Throws for a node outside the index. Without a
   * lot, the returned view is the tree's own storage and stays valid for the index's whole life:
   * a caller may hold it once and reread it after every pass, with nothing to copy.
   */
  world(node: Object3D): Float64Array;
  /** Recomputes the index from the local poses the host carries at this instant. */
  refresh(): void;
}

/** Nodes of the subtree and of its root's ancestors: the EXACT size the lot must carry. */
function hostWorldNodeCount(source: Object3D) {
  let n = 0;
  for (let walk = source.parent; walk; walk = walk.parent) n++;
  source.traverse(() => n++);
  return n;
}

/** Hierarchy lot that carries this subtree, or `null` when it is empty. */
export async function hostWorldLot(source: Object3D) {
  const n = hostWorldNodeCount(source);
  return n ? await createHierarchyLot(n) : null;
}

/** Nodes ranked parents before children, and each one's parent index (`-1` for the root). */
function collect(source: Object3D) {
  const nodes: Object3D[] = [];
  for (let walk = source.parent; walk; walk = walk.parent) nodes.push(walk);
  nodes.reverse();
  // The reference's `traverse` is a prefix walk: a parent is always seen before its children.
  source.traverse((object) => nodes.push(object));
  const index = new Map<Object3D, number>();
  for (let rank = 0; rank < nodes.length; rank++) index.set(nodes[rank], rank);
  const parents = new Int32Array(nodes.length);
  for (let rank = 0; rank < nodes.length; rank++) {
    const parent = nodes[rank].parent;
    parents[rank] = parent ? (index.get(parent) ?? -1) : -1;
  }
  return { nodes, index, parents };
}

/** Engine tree mirroring the host structure: one node per host node, at the same rank. */
function socle(nodes: readonly Object3D[], parents: Int32Array) {
  const tree = createTransformTree(Math.max(1, nodes.length));
  for (let rank = 0; rank < nodes.length; rank++) addTransformNode(tree, parents[rank]);
  return tree;
}

/** Host poses pushed where they moved, then the world pass over what that marked. */
function parArbre(nodes: readonly Object3D[], tree: TransformTree) {
  for (let rank = 0; rank < nodes.length; rank++) pushHostPose(tree, rank, nodes[rank]);
  updateNodeMatrixWorld(tree, 0);
}

/** Local poses written into the arena buffers, then the lot run by the governor. */
function parLot(nodes: readonly Object3D[], parents: Int32Array, lot: HierarchyLot) {
  const positions = lot.positions,
    rotations = lot.rotations,
    scales = lot.scales,
    liens = lot.parents;
  for (let rank = 0; rank < nodes.length; rank++) {
    const { position: p, quaternion: q, scale: s } = nodes[rank];
    const at = rank * POSITION_VALUES,
      turn = rank * QUATERNION_VALUES;
    positions[at] = p.x;
    positions[at + 1] = p.y;
    positions[at + 2] = p.z;
    rotations[turn] = q.x;
    rotations[turn + 1] = q.y;
    rotations[turn + 2] = q.z;
    rotations[turn + 3] = q.w;
    scales[at] = s.x;
    scales[at + 1] = s.y;
    scales[at + 2] = s.z;
    liens[rank] = parents[rank] < 0 ? HIERARCHY_ROOT : parents[rank];
  }
  lot.run();
}

/** True when each node recomposes its local matrix: the only shape the lot can receive. */
function composent(nodes: readonly Object3D[]) {
  for (const node of nodes) if (!node.matrixAutoUpdate) return false;
  return true;
}

/**
 * World-matrix index of `source`, recomputed a first time before it is returned. `lot` is the
 * hierarchy buffer reserved for this subtree; without it, the pass is that of the tree.
 */
export function hostWorldTree(source: Object3D, lot?: HierarchyLot | null): HostWorldTree {
  const { nodes, index, parents } = collect(source);
  const enLot = lot?.holds(nodes.length) ? lot : null;
  let tree: TransformTree | null = null,
    batched = false,
    porteur: ArrayBufferLike | null = null,
    views: Float64Array[] = [];
  /** Per-node views of the lot buffer, rebuilt when the module memory has grown. */
  const vuesDuLot = (monde: Float64Array) => {
    if (monde.buffer !== porteur) {
      porteur = monde.buffer;
      views = Array.from({ length: nodes.length }, (_, rank) =>
        monde.subarray(rank * MATRIX_VALUES, (rank + 1) * MATRIX_VALUES),
      );
    }
    return views;
  };
  const arbre = () => (tree ??= socle(nodes, parents));
  const self: HostWorldTree = {
    n: nodes.length,
    get batched() {
      return batched;
    },
    world(node) {
      const rank = index.get(node);
      if (rank === undefined)
        throw new EngineError('UNKNOWN_TRANSFORM_NODE', `${node.name}: node outside the index`, {
          nodeName: node.name,
        });
      return batched && enLot ? vuesDuLot(enLot.world)[rank] : arbre().worldViews[rank];
    },
    refresh() {
      if (!nodes.length) return;
      batched = enLot !== null && composent(nodes);
      if (batched && enLot) parLot(nodes, parents, enLot);
      else parArbre(nodes, arbre());
    },
  };
  self.refresh();
  return self;
}
