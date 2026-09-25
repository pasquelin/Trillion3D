import { SceneNode } from '../../scene/core/node.ts';
import {
  NODE_AUTO_UPDATE,
  NODE_LOCAL_CHANGED,
  NODE_TRS_DIRTY,
  NODE_WORLD_NEEDS_UPDATE,
} from '../../math/transform-tree/transformTree.ts';
import { updateNodeMatrixWorld, updateNodeWorldMatrix } from '../../math/transform-tree/update.ts';
import * as read from '../../math/transform-tree/read.ts';
import { Matrix4 } from '../math/matrix4.ts';
import { Quaternion } from '../math/quaternion.ts';
import { Vector3 } from '../math/vector3.ts';

// `matrix` and `matrixWorld` are views of the node's slot of the transform tree, whose flags answer
// `matrixAutoUpdate` and `matrixWorldNeedsUpdate`; `updateMatrixWorld(force)` is the reference's
// rule (`updateNodeMatrixWorld`). Reading `matrix` counts as a write — a caller may fill it in
// place — so the next update recomposes it or carries it to the world. A caller may point
// `matrix.elements` at storage of its own: the node then reads its pose there, its world included.
// A matrix handed out keeps its node alive (`owners`): its elements are the node's slot, which a
// collected node gives to another. Its bare `elements`, kept alone, carry no such guarantee.
const owners = new WeakMap<Matrix4, TransformNode>();
/** Scratch values of the world reads below: none of them allocates. */
const inverse = new Matrix4(),
  at = new Float64Array(4);

/** A scene node read through the reference's matrices, kept in the engine's transform tree. */
export class TransformNode extends SceneNode {
  private readonly local = this.owned(new Matrix4());
  private readonly world = this.owned(new Matrix4());
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
  private owned(matrix: Matrix4) {
    owners.set(matrix, this);
    return matrix;
  }
  /** Resolves the world matrices of the subtree, this node's parent taken as it stands. */
  updateMatrixWorld(force = false) {
    this.assertAlive();
    updateNodeMatrixWorld(this.state.tree, this.index, force);
  }
  /** Where the node stands in the world. */ getWorldPosition(out = new Vector3()) {
    return out.fromArray(read.nodeWorldPosition(at, this.state.tree, this.index));
  }
  /** How the node is turned in the world. */ getWorldQuaternion(out = new Quaternion()) {
    return out.fromArray(read.nodeWorldQuaternion(at, this.state.tree, this.index));
  }
  /** A point of the node's frame, in the world. */ localToWorld(v: Vector3) {
    this.updateWorldMatrix(true, false);
    return v.applyMatrix4(this.matrixWorld);
  }
  /** A point of the world, in the node's frame. */ worldToLocal(v: Vector3) {
    this.updateWorldMatrix(true, false);
    return v.applyMatrix4(inverse.copy(this.matrixWorld).invert());
  }
}
