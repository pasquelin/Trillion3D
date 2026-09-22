import { EngineError } from '../sdk-core/index.ts';
import type { HostNode } from './hostResources.ts';
import { hostWorldTree, type HostWorldTree } from './hostWorldTree.ts';
import type { MatrixElements } from './matrixElements.ts';

/**
 * World matrices THE ENGINE owns for the drawn nodes of the host scene.
 *
 * `hostWorldTree.ts` computes these matrices in the engine's transform tree; this file gives
 * each requested node the pose object that page records, cluster roots and transparent copies
 * carry. That object is a VIEW on the tree's own world buffer: its sixteen numbers are the ones
 * the tree just wrote, and a pass rewrites them in place. Nothing is copied here, so nothing can
 * go stale — that was the defect a snapshot of a host `matrixWorld` had already cost once — and
 * a scene change no longer pays a sixteen-number copy per drawn node.
 *
 * No host-library matrix is created, read or written: the pose crosses as sixteen flat numbers
 * (`MatrixElements`), which is what every consumer of the frame reads.
 *
 * A pose is returned ONCE per node and lives as long as the scene: what a pass rewrites,
 * everything that carries it sees at that instant.
 */
export interface HostWorldPlacements {
  /** Engine world matrix for `node`: the same object from call to call, its numbers always
   *  those of the last pass. Throws for a node outside the indexed subtree. */
  of(node: HostNode): MatrixElements;
  /** Recomputes the index from the host's local poses. Every pose already handed out reads the
   *  result: they are views on it. */
  refresh(): void;
}

/**
 * A pose handed out here is kept for the index's life, so it may only ever be a view that
 * outlives a pass. A LOT pass is the one that does not qualify: it rebuilds its views whenever
 * the module memory has grown, which would leave every pose handed out reading a dead buffer,
 * silently. The tree below is built WITHOUT a lot, so this cannot fire — it is what makes that
 * assumption fail loudly rather than quietly, if the construction ever changes.
 */
function assertStable(tree: HostWorldTree) {
  if (tree.batched)
    throw new EngineError('BATCHED_WORLD_VIEW', 'a lot pass cannot back a cached pose', {});
}

/** World-matrix index of `source`, ready to be read: the pass is that of the core tree
 *  (`hostWorldTree.ts`), which accepts both a node that recomposes its pose and a posed node. */
export function hostWorldPlacements(source: HostNode): HostWorldPlacements {
  // No lot: the pass runs on the tree, whose per-node views stay valid for the index's life.
  const tree = hostWorldTree(source);
  assertStable(tree);
  // Requested nodes, and them alone. One table, node → pose: the rank of a parallel list would
  // be a third way of saying the same thing, and one more to keep in agreement.
  const matrices = new Map<HostNode, MatrixElements>();
  return {
    of(node) {
      const held = matrices.get(node);
      if (held) return held;
      const matrix: MatrixElements = { elements: tree.world(node) };
      matrices.set(node, matrix);
      return matrix;
    },
    refresh() {
      tree.refresh();
      assertStable(tree);
    },
  };
}
