import { SceneNode } from '../../scene/core/node.ts';
import {
  NODE_AUTO_UPDATE,
  NODE_LOCAL_CHANGED,
  NODE_TRS_DIRTY,
  NODE_WORLD_NEEDS_UPDATE,
} from '../../math/transform-tree/transformTree.ts';
import { updateNodeMatrixWorld, updateNodeWorldMatrix } from '../../math/transform-tree/update.ts';
import { Matrix4 } from '../math/matrix4.ts';

// `matrix` and `matrixWorld` are views of the node's slot of the transform tree, whose flags answer
// `matrixAutoUpdate` and `matrixWorldNeedsUpdate`; `updateMatrixWorld(force)` is the reference's
// rule (`updateNodeMatrixWorld`). Reading `matrix` counts as a write — a caller may fill it in
// place — so the next update recomposes it or carries it to the world. A caller may point
// `matrix.elements` at storage of its own: the node then reads its pose there, its world included.
/** A scene node read through the reference's matrices, kept in the engine's transform tree. */
export class TransformNode extends SceneNode {
  private readonly local = new Matrix4();
  private readonly world = new Matrix4();
  /** The tree's view `matrix` last followed: a caller that re-pointed `elements` keeps its own. */
  private localView: Float64Array | null = null;
  /** Local matrix, a view of this node's slot of the transform tree. */
  get matrix(): Matrix4 {
    this.state.tree.flags[this.index] |= NODE_LOCAL_CHANGED | NODE_TRS_DIRTY;
    if (!this.adopted) this.local.elements = this.localView = this.localMatrix as Float64Array;
    return this.local;
  }
  /** The storage a caller pointed `matrix.elements` at, or `null` while it is the tree's. */
  private get adopted() {
    return this.localView && this.local.elements !== this.localView ? this.local.elements : null;
  }
  /** World matrix as last composed (`updateMatrixWorld`), a view of the tree. */
  get matrixWorld(): Matrix4 {
    const own = this.adopted;
    if (own) {
      this.setLocalMatrix(own);
      updateNodeWorldMatrix(this.state.tree, this.index, false, false);
    }
    this.world.elements = this.worldMatrix as Float64Array;
    return this.world;
  }
  /** False when `matrix` IS the pose and nothing recomposes it. */
  get matrixAutoUpdate() {
    return (this.state.tree.flags[this.index] & NODE_AUTO_UPDATE) !== 0;
  }
  set matrixAutoUpdate(auto: boolean) {
    this.setAutoUpdate(auto);
  }
  /** Set when the local matrix changed and the world matrix has not followed. */
  get matrixWorldNeedsUpdate() {
    return (this.state.tree.flags[this.index] & NODE_WORLD_NEEDS_UPDATE) !== 0;
  }
  set matrixWorldNeedsUpdate(needs: boolean) {
    if (needs) this.state.tree.flags[this.index] |= NODE_WORLD_NEEDS_UPDATE | NODE_LOCAL_CHANGED;
    else this.state.tree.flags[this.index] &= ~NODE_WORLD_NEEDS_UPDATE;
  }
  /** Resolves the world matrices of the subtree, this node's parent taken as it stands. */
  updateMatrixWorld(force = false) {
    this.assertAlive();
    updateNodeMatrixWorld(this.state.tree, this.index, force);
  }
}
