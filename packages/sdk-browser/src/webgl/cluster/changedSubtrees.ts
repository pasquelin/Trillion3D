import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import {
  NODE_AUTO_UPDATE,
  NODE_WORLD_NEEDS_UPDATE,
} from '../../../../sdk-core/src/math/transform-tree/transformTree.ts';
import { updateNodeMatrixWorld } from '../../../../sdk-core/src/math/transform-tree/update.ts';

/** The flags that make the tree's rule reach a node (`reach` in `updateNodeMatrixWorld`). */
const NODE_REACH = NODE_AUTO_UPDATE | NODE_WORLD_NEEDS_UPDATE;

/**
 * THE WORLD MATRICES OF A DISPLAY GRAPH, BROUGHT UP TO DATE WHERE IT CHANGED (#984, CPU-22): the
 * engine's own pass (`updateNodeMatrixWorld`) run on the subtree of each node the graph's link
 * heard — a pose written (`pose`, `posed`), a child added or taken (`structure`, on the parent) —
 * never on the whole graph again. The graph's first pass walks it whole.
 *
 * INVARIANT: after `run()` every node under `scene` holds the world matrix a full recomposition of the scene
 * would give it, bit for bit. The tree recomputes a walked node only when an input changed, and
 * every input change is heard: a pose setter tells the link (`objectPose.ts`), a reparent the
 * parent's `structure`, and whoever writes a matrix in place tells the link itself (`setHostPose`).
 * A heard node is walked with the reach its chain gives it in the full pass — reached when a node
 * above it updates itself or is marked — so a node the full pass skips stays skipped. A node under
 * another heard one is walked by that one's pass; one no longer under `scene` is not drawn, and
 * the pass that takes it back walks it again (a reparent marks it).
 */
export function createChangedSubtrees(scene: Object3D) {
  const pending = new Set<Object3D>([scene]);
  return {
    /** `node`'s pose or children changed: its subtree is walked at the next `run`. */
    heard(node: Object3D) {
      pending.add(node);
    },
    /** Walks the subtree of every heard node still under `scene`, parents first; how many nodes
     *  it walked. */
    run() {
      let walked = 0;
      for (const node of pending) {
        // A node taken off the graph since it was heard lost the graph's link, and one destroyed
        // was taken off first: neither is drawn, and a destroyed one may not be read.
        if (node._link !== scene._link) continue;
        // One climb to `scene`: cut short above a heard node (its pass walks `node`) or a root
        // (`node` is no longer drawn); on the way, whether the full pass would reach `node`.
        let at = node,
          reached = false;
        while (at !== scene) {
          const parent: Object3D | null = at.parent;
          if (!parent || pending.has(parent)) break;
          reached ||= (Object3D._treeOf(parent).flags[parent.index] & NODE_REACH) !== 0;
          at = parent;
        }
        if (at === scene)
          walked += updateNodeMatrixWorld(Object3D._treeOf(node), node.index, reached);
      }
      pending.clear();
      return walked;
    },
  };
}
