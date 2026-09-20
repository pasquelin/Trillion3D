import {
  NODE_ALIVE,
  setNodeAutoUpdate,
  setNodeLocalMatrix,
  setNodePosition,
  setNodeQuaternion,
  setNodeScale,
} from './mathTransformTree.ts';
import { removeTransformNode, reparentTransformNode } from './mathTransformTreeStructure.ts';
import { updateNodeWorldMatrix } from './mathTransformTreeUpdate.ts';
import { copySceneNodeState } from './sceneNodeCopy.ts';
import { sceneNodeFail, sceneNodeVisibility } from './sceneNodeError.ts';
import type { SceneNodeOptions, SceneState } from './sceneNodeContracts.ts';
import type { SceneRoot } from './sceneRoot.ts';

export { SCENE_MODEL_VERSION, type SceneNodeOptions } from './sceneNodeContracts.ts';

/** A stable handle into one engine-owned transform hierarchy. */
export class SceneNode {
  private childNodes: readonly SceneNode[] = Object.freeze([]);
  protected readonly state: SceneState;
  readonly id: string;
  readonly index: number;
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

  get visible() {
    this.assertAlive();
    return this.visibleState;
  }

  set visible(value: boolean) {
    this.assertAlive();
    this.visibleState = sceneNodeVisibility(value);
  }

  /** Parent in the scene, or null while detached. */
  get parent(): SceneNode | null {
    this.assertAlive();
    const index = this.state.tree.parent[this.index];
    return index < 0 ? null : (this.state.nodes.get(index) ?? null);
  }

  /** Attached children in insertion order. The returned list cannot be mutated. */
  get children(): readonly SceneNode[] {
    this.assertAlive();
    return this.childNodes;
  }

  /** Read-only by contract; use setLocalMatrix to mark the transform dirty. */
  get localMatrix(): Readonly<Float64Array> {
    this.assertAlive();
    return this.state.tree.localViews[this.index];
  }

  /** Current world matrix; call updateWorldMatrix after changing a pose. */
  get worldMatrix(): Readonly<Float64Array> {
    this.assertAlive();
    return this.state.tree.worldViews[this.index];
  }

  add(child: SceneNode) {
    this.assertCompatible(child);
    if (child.index === this.state.root?.index)
      sceneNodeFail('SCENE_ROOT_PARENT', 'A scene root cannot be reparented', {});
    const previous = child.parent;
    reparentTransformNode(this.state.tree, child.index, this.index);
    previous?.detachChild(child);
    this.childNodes = Object.freeze([...this.childNodes, child]);
    return this;
  }

  remove(child: SceneNode) {
    this.assertCompatible(child);
    if (child.parent !== this) return this;
    reparentTransformNode(this.state.tree, child.index, -1);
    this.detachChild(child);
    return this;
  }

  clear() {
    this.assertAlive();
    for (let i = this.childNodes.length - 1; i >= 0; i--) this.remove(this.childNodes[i]);
    return this;
  }

  reparent(parent: SceneNode | null) {
    this.assertAlive();
    if (this.index === this.state.root?.index)
      sceneNodeFail('SCENE_ROOT_PARENT', 'A scene root cannot be reparented', {});
    if (parent) parent.add(this);
    else this.parent?.remove(this);
    return this;
  }

  clone(recursive = true, options: SceneNodeOptions = {}) {
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

  setPosition(x: number, y: number, z: number) {
    this.assertAlive();
    setNodePosition(this.state.tree, this.index, x, y, z);
    return this;
  }

  setQuaternion(x: number, y: number, z: number, w: number) {
    this.assertAlive();
    setNodeQuaternion(this.state.tree, this.index, x, y, z, w);
    return this;
  }

  setScale(x: number, y: number, z: number) {
    this.assertAlive();
    setNodeScale(this.state.tree, this.index, x, y, z);
    return this;
  }

  setLocalMatrix(matrix: ArrayLike<number>) {
    this.assertAlive();
    setNodeLocalMatrix(this.state.tree, this.index, matrix);
    return this;
  }

  setAutoUpdate(auto: boolean) {
    this.assertAlive();
    setNodeAutoUpdate(this.state.tree, this.index, auto);
    return this;
  }

  updateWorldMatrix(updateParents = true, updateChildren = true) {
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

  private detachChild(child: SceneNode) {
    const at = this.childNodes.indexOf(child);
    if (at >= 0) this.childNodes = Object.freeze(this.childNodes.filter((node) => node !== child));
  }

  private invalidate() {
    const pending: SceneNode[] = [this];
    while (pending.length) {
      const node = pending.pop()!;
      for (const child of node.childNodes) pending.push(child);
      node.childNodes = Object.freeze([]);
      node.#alive = false;
      this.state.nodes.delete(node.index);
      this.state.ids.delete(node.id);
    }
  }
}
