import * as THREE from 'three';
import type { HostNode } from './hostResources.ts';
import { hostWorldTree } from './hostWorldTree.ts';
import { copyElements } from './matrixElements.ts';

/**
 * World matrices THE ENGINE owns for the drawn nodes of the host scene.
 *
 * `hostWorldTree.ts` computes these matrices from local poses; this file gives them the
 * container that page records and cluster roots still carry — a host-library matrix, because
 * that is what the host attaches to its graph and what witness engines draw. The container is
 * the only borrow: its sixteen numbers all come from the core, and the source mesh's
 * `matrixWorld` is neither read nor written.
 *
 * A matrix is returned ONCE per node and lives as long as the scene: what `refresh` rewrites,
 * everything that carries it sees at that instant — a page record, a root, a transparent copy.
 * That was the defect a snapshot of `matrixWorld` had already cost once: here no snapshot is
 * taken, so none has to be retaken.
 */
export interface HostWorldPlacements {
  /** Engine world matrix for `node`: the same object from call to call. Throws for a node
   *  outside the indexed subtree. */
  of(node: THREE.Object3D): THREE.Matrix4;
  /** Recomputes the index from the host's local poses, then rewrites the returned matrices. */
  refresh(): void;
}

/** World-matrix index of `source`, ready to be read: the pass is that of the core tree
 *  (`hostWorldTree.ts`), which accepts both a node that recomposes its pose and a posed node. */
export function hostWorldPlacements(source: HostNode): HostWorldPlacements {
  const tree = hostWorldTree(source);
  // Requested nodes, and them alone: a scene whose twelve nodes carry pages copies only twelve
  // matrices per scene change. One table, node → matrix: the rank of a parallel list would be a
  // third way of saying the same thing, and one more to keep in agreement.
  const matrices = new Map<THREE.Object3D, THREE.Matrix4>();
  return {
    of(node) {
      const held = matrices.get(node);
      if (held) return held;
      const matrix = new THREE.Matrix4();
      copyElements(matrix.elements, tree.world(node));
      matrices.set(node, matrix);
      return matrix;
    },
    refresh() {
      tree.refresh();
      for (const [node, matrix] of matrices) copyElements(matrix.elements, tree.world(node));
    },
  };
}
