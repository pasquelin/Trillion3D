import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import {
  NODE_AUTO_UPDATE,
  NODE_WORLD_NEEDS_UPDATE,
} from '../../../../sdk-core/src/math/transform-tree/transformTree.ts';
import { updateNodeMatrixWorld } from '../../../../sdk-core/src/math/transform-tree/update.ts';
import { rootedUnder } from '../../host/world/chain.ts';

/** The flags that make the tree's rule reach a node (`updateNodeMatrixWorld`). */
const REACH = NODE_AUTO_UPDATE | NODE_WORLD_NEEDS_UPDATE;

/**
 * THE WORLD MATRICES OF A DISPLAY GRAPH, BROUGHT UP TO DATE WHERE IT CHANGED (#984, CPU-22): the
 * engine's own pass (`updateNodeMatrixWorld`) run on the subtree of each node the graph's link
 * heard — a pose written (`pose`, `posed`), a child added or taken (`structure`, on the parent) —
 * never on the whole graph again. The graph's first pass walks it whole.
 *
 * INVARIANT: after `run()` every node under `scene` holds the world matrix `scene.updateMatrixWorld()`
 * would give it, bit for bit. The tree recomputes a walked node only when an input changed, and
 * every input change is heard: a pose setter tells the link (`objectPose.ts`), a reparent the
 * parent's `structure`, and a matrix written in place says so itself (`setHostPose`). A heard
 * node is walked with the reach its chain gives it in the full pass — reached when a node above
 * it updates itself or is marked — so a node the full pass skips stays skipped. A node under
 * another heard one is walked by that one's pass; one no longer under `scene` is not drawn, and
 * the pass that takes it back walks it again (a reparent marks it).
 */
export function createChangedSubtrees(scene: Object3D) {
  const heard = new Set<Object3D>([scene]);
  /** True when the full pass would reach `node`'s children: `node` or one above it, up to
   *  `scene` where that pass starts, updates itself or is marked. */
  const reaches = (node: Object3D) => {
    for (let at: Object3D | null = node; at; at = at.parent) {
      if (Object3D._treeOf(at).flags[at.index] & REACH) return true;
      if (at === scene) return false;
    }
    return false;
  };
  /** True when a node above `node` was heard too: its pass covers `node`. */
  const covered = (node: Object3D) => {
    for (let at = node.parent; at; at = at.parent) if (heard.has(at)) return true;
    return false;
  };
  return {
    /** `node`'s pose or children changed: its subtree is walked at the next `run`. */
    heard(node: Object3D) {
      heard.add(node);
    },
    /** Walks the subtree of every heard node still under `scene`, parents first; how many nodes
     *  it walked. */
    run() {
      let walked = 0;
      if (!heard.size) return walked;
      for (const node of heard)
        if (rootedUnder(node, scene) && !covered(node)) {
          const reached = node !== scene && reaches(node.parent!);
          walked += updateNodeMatrixWorld(Object3D._treeOf(node), node.index, reached);
        }
      heard.clear();
      return walked;
    },
  };
}
