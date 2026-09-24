import {
  NODE_ALIVE,
  setNodeAutoUpdate,
  setNodeLocalMatrix,
  setNodePosition,
  setNodeQuaternion,
  setNodeScale,
} from '../../math/transform-tree/transformTree.ts';
import { removeTransformNode, reparentTransformNode } from '../../math/transform-tree/structure.ts';
import { updateNodeWorldMatrix } from '../../math/transform-tree/update.ts';
import { copySceneNodeState } from './nodeCopy.ts';
import { sceneNodeFail, sceneNodeVisibility } from './nodeError.ts';
import type { SceneNodeOptions, SceneState } from './nodeContracts.ts';
import type { SceneRoot } from './root.ts';

export { SCENE_MODEL_VERSION, type SceneNodeOptions } from './nodeContracts.ts';

/** A stable handle into one engine-owned transform hierarchy. */
export class SceneNode {
  /** Children in insertion order; `children` hands out a frozen copy, remade after a change. */
  private childNodes: SceneNode[] = [];
  private childView: readonly SceneNode[] | null = null;
  private parentNode: SceneNode | null = null; // Held here: a node map would keep it alive.
  protected readonly state: SceneState;
  /** The node's name in the tree. */ readonly id: string;
  /** Its slot in the tree. */ readonly index: number;
  private visibleState: boolean;
  #alive = true;

  constructor(state: SceneState, id: string, index: number, visible = true) {
    this.state = state;
    this.id = id;
    this.index = index;
    this.visibleState = visible;
  }

  /** Root that owns this node and its transform storage. */
  get root(): SceneRoot {
    return this.state.root as SceneRoot;
  }
  /** Whether it is drawn. */ get visible() {
    this.assertAlive();
    return this.visibleState;
  }
  set visible(value: boolean) {
    this.assertAlive();
    this.visibleState = sceneNodeVisibility(value, false);
  }
  /** Parent in the scene, or null while detached. */
  get parent(): SceneNode | null {
    this.assertAlive();
    return this.parentNode;
  }
  /** Attached children in insertion order. The returned list cannot be mutated. */
  get children(): readonly SceneNode[] {
    this.assertAlive();
    return (this.childView ??= Object.freeze(this.childNodes.slice()));
  }
  // Both matrices are views of the node's slot, reused once the node is gone: never keep one past it.
  /** Read-only by contract, valid while the node lives; setLocalMatrix marks the transform dirty. */
  get localMatrix(): Readonly<Float64Array> {
    this.assertAlive();
    return this.state.tree.localViews[this.index];
  }
  /** Current world matrix, valid while the node lives; updateWorldMatrix after a pose change. */
  get worldMatrix(): Readonly<Float64Array> {
    this.assertAlive();
    return this.state.tree.worldViews[this.index];
  }

  /** Adds a child. */ add(child: SceneNode) {
    this.assertCompatible(child);
    if (child.index === this.state.root?.index)
      sceneNodeFail('SCENE_ROOT_PARENT', 'A scene root cannot be reparented', {});
    const previous = child.parent;
    reparentTransformNode(this.state.tree, child.index, this.index);
    previous?.detachChild(child);
    this.childNodes.push(child);
    this.childView = null;
    child.parentNode = this;
    return this;
  }

  /** Removes a child. */ remove(child: SceneNode) {
    this.assertCompatible(child);
    if (child.parent !== this) return this;
    reparentTransformNode(this.state.tree, child.index, -1);
    this.detachChild(child);
    return this;
  }

  /** Removes every child. */ clear() {
    this.assertAlive();
    for (let i = this.childNodes.length - 1; i >= 0; i--) this.remove(this.childNodes[i]);
    return this;
  }

  /** Moves it under another parent. */ reparent(parent: SceneNode | null) {
    this.assertAlive();
    if (this.index === this.state.root?.index)
      sceneNodeFail('SCENE_ROOT_PARENT', 'A scene root cannot be reparented', {});
    if (parent) parent.add(this);
    else this.parent?.remove(this);
    return this;
  }

  /** A copy, children too. */ clone(recursive = true, options: SceneNodeOptions = {}) {
    this.assertAlive();
    const clone = this.root.createNode(options);
    clone.copy(this, recursive);
    return clone;
  }

  /** Copies values and descendants; recursive ancestor-to-descendant overlap is refused atomically. */
  copy(source: SceneNode, recursive = true) {
    this.assertCompatible(source);
    if (source === this) return this;
    copySceneNodeState(this.state, this, source, recursive);
    return this;
  }

  /** Sets its position. */ setPosition(x: number, y: number, z: number) {
    this.assertAlive();
    setNodePosition(this.state.tree, this.index, x, y, z);
    return this;
  }

  /** Sets its rotation. */ setQuaternion(x: number, y: number, z: number, w: number) {
    this.assertAlive();
    setNodeQuaternion(this.state.tree, this.index, x, y, z, w);
    return this;
  }

  /** Sets its size. */ setScale(x: number, y: number, z: number) {
    this.assertAlive();
    setNodeScale(this.state.tree, this.index, x, y, z);
    return this;
  }

  /** Sets its local matrix. */ setLocalMatrix(matrix: ArrayLike<number>) {
    this.assertAlive();
    setNodeLocalMatrix(this.state.tree, this.index, matrix);
    return this;
  }

  /** Whether its matrix follows its pose. */ setAutoUpdate(auto: boolean) {
    this.assertAlive();
    setNodeAutoUpdate(this.state.tree, this.index, auto);
    return this;
  }

  /** Updates its world matrix. */ updateWorldMatrix(updateParents = true, updateChildren = true) {
    this.assertAlive();
    updateNodeWorldMatrix(this.state.tree, this.index, updateParents, updateChildren);
    return this;
  }

  /** Permanently invalidates this handle and every descendant. */
  destroy() {
    this.assertAlive();
    if (this.index === this.state.root?.index)
      sceneNodeFail('SCENE_ROOT_DESTROY', 'A scene root cannot be destroyed', {});
    this.parent?.detachChild(this);
    this.invalidate();
    removeTransformNode(this.state.tree, this.index);
  }

  protected assertAlive() {
    if (!this.#alive || !(this.state.tree.flags[this.index] & NODE_ALIVE))
      sceneNodeFail('STALE_SCENE_NODE', `Scene node ${this.id} was destroyed`, { id: this.id });
  }

  private assertCompatible(node: SceneNode) {
    this.assertAlive();
    node.assertAlive();
    if (this.state !== node.state)
      sceneNodeFail('SCENE_ROOT_MISMATCH', 'Scene nodes belong to different roots', {
        node: node.id,
        parent: this.id,
      });
  }

  /** From the end: `clear` detaches in O(1); an absent child (−1 >>> 0) splices none. */
  private detachChild(child: SceneNode) {
    this.childNodes.splice(this.childNodes.lastIndexOf(child) >>> 0, 1);
    this.childView = child.parentNode = null;
  }

  private invalidate() {
    const pending: SceneNode[] = [this];
    while (pending.length) {
      const node = pending.pop()!;
      for (const child of node.childNodes) pending.push(child);
      node.childNodes = [];
      node.#alive = false;
      this.state.ids.delete(node.id);
    }
  }
}
