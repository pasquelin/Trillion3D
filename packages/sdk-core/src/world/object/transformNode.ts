import { SceneNode } from '../../scene/core/node.ts';
import {
  NODE_AUTO_UPDATE,
  NODE_LOCAL_CHANGED,
  NODE_TRS_DIRTY,
  NODE_WORLD_NEEDS_UPDATE,
  markTransformNode,
} from '../../math/transform-tree/transformTree.ts';
import { updateNodeMatrixWorld, updateNodeWorldMatrix } from '../../math/transform-tree/update.ts';
import * as read from '../../math/transform-tree/read.ts';
import { Matrix4 } from '../math/matrix4.ts';
import { Quaternion } from '../math/quaternion.ts';
import { Vector3 } from '../math/vector3.ts';
import { noteNodeWrite, noteObjectEdit } from '../../scene/core/nodeEdits.ts';
import { keepNumbers } from '../../math/primitives/vector.ts';
import { copyMatrix4 } from '../../math/matrix/matrix4.ts';

// `matrix` and `matrixWorld` are views of the node's slot of the transform tree, whose flags answer
// `matrixAutoUpdate` and `matrixWorldNeedsUpdate`; `updateMatrixWorld(force)` follows the engine's
// rule (`updateNodeMatrixWorld`). Reading `matrix` counts as a write — a caller may fill it in
// place — so the next update recomposes it or carries it to the world, and the frame pass walks it.
// A caller may point `matrix.elements` at storage of its own: the node then reads its pose there,
// its world included. A matrix handed out keeps its node alive (`owners`): its elements are the
// node's slot, which a collected node gives to another. Its bare `elements`, kept alone, carry no
// such guarantee.
const owners = new WeakMap<Matrix4, TransformNode>();
/** Scratch values of the world reads below: none of them allocates. */
const inverse = new Matrix4(),
  at = new Float64Array(4);

/** A scene node read through host-shaped matrices, kept in the engine's transform tree. */
export class TransformNode extends SceneNode {
  #name = '';
  // A change of name is counted (`objectEdits`): a name index holds only while the count stands.
  /** A name to find the node by. */
  get name() {
    return this.#name;
  }
  set name(value: string) {
    if (value !== this.#name) noteObjectEdit();
    this.#name = value;
  }
  private readonly local = this.owned(new Matrix4());
  private readonly world = this.owned(new Matrix4());
  /** The tree's view `matrix` last followed: a caller that re-pointed `elements` keeps its own. */
  private localView: Float64Array | null = null;
  /** Local matrix, a view of this node's slot of the transform tree. */
  get matrix(): Matrix4 {
    markTransformNode(this.state.tree, this.index, NODE_LOCAL_CHANGED | NODE_TRS_DIRTY);
    noteNodeWrite();
    if (!this.adopted) this.local.elements = this.localView = this.localMatrix as Float64Array;
    return this.local;
  }
  /** `matrix.elements` read without counting as a write: what a comparison reads frame after
   *  frame. */
  get _matrixElements(): Readonly<Float64Array> {
    return this.adopted ?? this.localMatrix;
  }
  /** The matrix the host set changed behind the getter — through a reference kept, or in storage of
   *  its own: taken into the tree, and the node listed for the frame pass and the update rule. */
  _matrixMoved() {
    this.takeStorage();
    this.matrixWorldNeedsUpdate = true;
  }
  /** Sets its local matrix; storage of its own a caller points `matrix.elements` at takes it too,
   *  so the two never disagree (`takeStorage` keeps the storage's when it moves). */
  override setLocalMatrix(matrix: ArrayLike<number>) {
    super.setLocalMatrix(matrix);
    const own = this.adopted;
    if (own && own !== matrix) copyMatrix4(own, matrix);
    return this;
  }
  /** Whether its matrix follows its pose; cut, the storage of its own it points `matrix.elements`
   *  at is the pose from now on (`takeStorage`). */
  override setAutoUpdate(auto: boolean) {
    super.setAutoUpdate(auto);
    if (!auto) this.takeStorage();
    return this;
  }
  /** The storage a caller pointed `matrix.elements` at, or `null` while it is the tree's. */
  private get adopted() {
    return this.localView && this.local.elements !== this.localView ? this.local.elements : null;
  }
  /** World matrix as last composed (`updateMatrixWorld`), a view of the tree. */
  get matrixWorld(): Matrix4 {
    if (this.adopted) {
      this.takeStorage();
      updateNodeWorldMatrix(this.state.tree, this.index, false, false);
    }
    this.world.elements = this.worldMatrix as Float64Array;
    return this.world;
  }
  /** How many times the tree recalculated this node's world matrix (`version`): it moves whenever
   *  `matrixWorld` does — a node posed by storage of its own read through `matrixWorld` first. */
  get _worldVersion() {
    if (this.localView) void this.matrixWorld;
    return this.state.tree.version[this.index];
  }
  /** False when `matrix` IS the pose and nothing recomposes it. */
  get matrixAutoUpdate() {
    return (this.state.tree.flags[this.index] & NODE_AUTO_UPDATE) !== 0;
  }
  set matrixAutoUpdate(auto: boolean) {
    this.setAutoUpdate(auto);
  }
  /** Set when the local matrix changed and the world matrix has not followed. Setting it is how
   *  numbers written straight into a `matrix.elements` kept from an earlier read, or into storage
   *  of its own, are announced: the write is counted (`nodeWrites`), and the scene watch reads
   *  it. */
  get matrixWorldNeedsUpdate() {
    return (this.state.tree.flags[this.index] & NODE_WORLD_NEEDS_UPDATE) !== 0;
  }
  set matrixWorldNeedsUpdate(needs: boolean) {
    if (!needs) {
      this.state.tree.flags[this.index] &= ~NODE_WORLD_NEEDS_UPDATE;
      return;
    }
    markTransformNode(this.state.tree, this.index, NODE_WORLD_NEEDS_UPDATE | NODE_LOCAL_CHANGED);
    noteNodeWrite();
  }
  private owned(matrix: Matrix4) {
    owners.set(matrix, this);
    return matrix;
  }
  /** Takes into the tree the storage of its own that each node from here up points
   *  `matrix.elements` at, where its numbers moved: what a world read of the chain does first. A
   *  node's own subtree is not walked for it: numbers written straight into an array are seen where
   *  they are read (`matrixWorld`, a world read below), or by the scene watch's comparison. */
  protected takeChainStorage() {
    this.takeStorage();
    for (let node = this.parent; node instanceof TransformNode; node = node.parent)
      node.takeStorage();
  }
  /** Its storage of its own into the tree, where its numbers moved, while recomposition is cut:
   *  a node that recomposes its matrix from its pose reads none of it. Copied once, then listed. */
  private takeStorage() {
    const own = this.adopted;
    if (!own) return;
    this.assertAlive();
    if (this.matrixAutoUpdate) return;
    if (keepNumbers(this.localMatrix as Float64Array, own)) return;
    markTransformNode(this.state.tree, this.index, NODE_LOCAL_CHANGED | NODE_TRS_DIRTY);
    noteNodeWrite();
  }
  /** Updates its world matrix, the chain's storage of its own taken first (`takeChainStorage`). */
  override updateWorldMatrix(updateParents = true, updateChildren = true) {
    if (updateParents) this.takeChainStorage();
    return super.updateWorldMatrix(updateParents, updateChildren);
  }
  /** Resolves the world matrices of the subtree, this node's parent taken as it stands. */
  updateMatrixWorld(force = false) {
    this.assertAlive();
    updateNodeMatrixWorld(this.state.tree, this.index, force);
  }
  /** Where the node stands in the world. */ getWorldPosition(out = new Vector3()) {
    this.takeChainStorage();
    return out.fromArray(read.nodeWorldPosition(at, this.state.tree, this.index));
  }
  /** How the node is turned in the world. */ getWorldQuaternion(out = new Quaternion()) {
    this.takeChainStorage();
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
