import {
  EngineError,
  HIERARCHY_ROOT,
  MATRIX_VALUES,
  POSITION_VALUES,
  QUATERNION_VALUES,
  updateNodeMatrixWorld,
  type TransformTree,
} from '../../../../sdk-core/src/index.ts';
import { visitSubtree } from '../../../../sdk-core/src/math/transform-tree/structure.ts';
import { chainPosed, heldParentWorld, pushHostPose } from './pose.ts';
import { collect, relinkHostTree, socle } from './treeLinks.ts';
import { objectEdits } from '../../../../sdk-core/src/scene/core/nodeEdits.ts';
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
  /** `refresh()` on the subtree of `node` alone, the whole pass if an ancestor moved, the node is
   *  outside the index or the index runs as a lot. Nodes outside keep their last pass. */
  refreshFrom(node: Object3D): void;
  /** The world of `node`'s parent as the tree holds it, current with the host (`pose.ts`). */
  parentWorld(node: Object3D): Float64Array | null;
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

/** Host poses pushed where they moved, then the world pass over what that marked, from each root:
 *  the first rank, and any node a host reparent left under no indexed node (`treeLinks.ts`). */
function parArbre(nodes: readonly Object3D[], parents: Int32Array, tree: TransformTree) {
  for (let rank = 0; rank < nodes.length; rank++) pushHostPose(tree, rank, nodes[rank]);
  for (let rank = 0; rank < nodes.length; rank++)
    if (parents[rank] < 0) updateNodeMatrixWorld(tree, rank);
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
  let enLot = lot?.holds(nodes.length) ? lot : null,
    edits = objectEdits();
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
  const push = (into: TransformTree, rank: number) => void pushHostPose(into, rank, nodes[rank]);
  /** True when a node was renamed or reparented since the links were read: they are read again
   *  (`treeLinks.ts`), and the caller passes the index whole. */
  const relinked = () => {
    if (edits === objectEdits()) return false;
    edits = objectEdits();
    if (!relinkHostTree(tree, nodes, index, parents)) enLot = null;
    return true;
  };
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
      relinked();
      if (!nodes.length) return;
      batched = enLot !== null && composent(nodes);
      if (batched && enLot) parLot(nodes, parents, enLot);
      else parArbre(nodes, parents, arbre());
    },
    refreshFrom(node) {
      const rank = index.get(node);
      // A lot pass is all or nothing, and a node outside the index has no subtree here.
      if (rank === undefined || enLot || relinked()) return self.refresh();
      const at = arbre();
      // An ancestor posed since the last pass moves the subtree from above: whole pass then.
      if (chainPosed(at, nodes, parents, parents[rank])) return self.refresh();
      visitSubtree(at, rank, push);
      updateNodeMatrixWorld(at, rank);
    },
    parentWorld(node) {
      if (relinked()) self.refresh();
      return enLot || !node.parent
        ? null
        : heldParentWorld(arbre(), nodes, parents, index.get(node.parent), self.refresh);
    },
  };
  self.refresh();
  return self;
}
