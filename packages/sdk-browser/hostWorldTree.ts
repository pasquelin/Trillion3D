import type * as THREE from 'three';
import { asHostLibrary } from './hostResources.ts';
import type { HostNode } from './hostResources.ts';
import {
  EngineError,
  HIERARCHY_ROOT,
  MATRIX_VALUES,
  POSITION_VALUES,
  QUATERNION_VALUES,
  addTransformNode,
  createTransformTree,
  setNodeAutoUpdate,
  setNodeLocalMatrix,
  updateNodeMatrixWorld,
  type TransformTree,
} from '../sdk-core/index.ts';
import { hostLocalInto } from './hostWorldMatrices.ts';
import { createHierarchyLot, type HierarchyLot } from './mathBatchHierarchy.ts';

/**
 * World matrices of a HOST SUBTREE, computed by the engine from local poses.
 *
 * The index covers the subtree of `source` AND the ancestor chain of its root, parents before
 * children: each node composes its local matrix, then multiplies it by its parent's world
 * matrix. This is the reference's `updateMatrixWorld(true)` rule, with the core formulas in the
 * same order — the same bits.
 *
 * TWO PATHS, ONE TRUTH. When the whole subtree recomposes its pose and a hierarchy lot carries
 * it exactly, the pass goes AS A LOT: poses are written into the arena buffers, the governor
 * chooses JavaScript or WebAssembly, and world matrices stay where the kernel wrote them —
 * nothing is copied, and views are rebuilt when the module memory has grown. Otherwise — a node
 * whose host cut recomposition carries a set matrix, which the lot cannot receive — the pass
 * runs on the core tree, which accepts both.
 *
 * The engine keeps ITS copy: no host `matrixWorld` is written, nor even read.
 */

export interface HostWorldTree {
  /** Indexed nodes: the subtree, and the ancestors of its root. */
  readonly n: number;
  /** True when the last recompute went as a lot; false when it went through the tree. */
  readonly batched: boolean;
  /** World matrix the ENGINE computed for `node`. Throws for a node outside the index. */
  world(node: THREE.Object3D): Float64Array;
  /** Recomputes the whole index from the local poses the host carries at this instant. */
  refresh(): void;
}

/** Nodes of the subtree and of its root's ancestors: the EXACT size the lot must carry. */
function hostWorldNodeCount(source: THREE.Object3D) {
  let n = 0;
  for (let walk = source.parent; walk; walk = walk.parent) n++;
  source.traverse(() => n++);
  return n;
}

/** Hierarchy lot that carries this subtree, or `null` when it is empty. */
export async function hostWorldLot(source: THREE.Object3D) {
  const n = hostWorldNodeCount(source);
  return n ? await createHierarchyLot(n) : null;
}

/** Nodes ranked parents before children, and each one's parent index (`-1` for the root). */
function collect(source: THREE.Object3D) {
  const nodes: THREE.Object3D[] = [];
  for (let walk = source.parent; walk; walk = walk.parent) nodes.push(walk);
  nodes.reverse();
  // The reference's `traverse` is a prefix walk: a parent is always seen before its children.
  source.traverse((object) => nodes.push(object));
  const index = new Map<THREE.Object3D, number>();
  for (let rank = 0; rank < nodes.length; rank++) index.set(nodes[rank], rank);
  const parents = new Int32Array(nodes.length);
  for (let rank = 0; rank < nodes.length; rank++) {
    const parent = nodes[rank].parent;
    parents[rank] = parent ? (index.get(parent) ?? -1) : -1;
  }
  return { nodes, index, parents };
}

/** Core tree that receives the poses: each node carries the local matrix the engine read. */
function socle(nodes: readonly THREE.Object3D[], parents: Int32Array) {
  const tree = createTransformTree(Math.max(1, nodes.length));
  for (let rank = 0; rank < nodes.length; rank++)
    setNodeAutoUpdate(tree, addTransformNode(tree, parents[rank]), false);
  return tree;
}

const scratch = new Float64Array(MATRIX_VALUES);

/** Local poses read, set in the tree, then the whole subtree walked up in one pass. */
function parArbre(nodes: readonly THREE.Object3D[], tree: TransformTree) {
  for (let rank = 0; rank < nodes.length; rank++)
    setNodeLocalMatrix(tree, rank, hostLocalInto(scratch, nodes[rank]));
  updateNodeMatrixWorld(tree, 0, true);
}

/** Local poses written into the arena buffers, then the lot run by the governor. */
function parLot(nodes: readonly THREE.Object3D[], parents: Int32Array, lot: HierarchyLot) {
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
function composent(nodes: readonly THREE.Object3D[]) {
  for (const node of nodes) if (!node.matrixAutoUpdate) return false;
  return true;
}

/**
 * World-matrix index of `source`, recomputed a first time before it is returned. `lot` is the
 * hierarchy buffer reserved for this subtree; without it, the pass is that of the tree.
 */
export function hostWorldTree(source: HostNode, lot?: HierarchyLot | null): HostWorldTree {
  const { nodes, index, parents } = collect(asHostLibrary<THREE.Object3D>(source));
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
