import { addTransformNode, createTransformTree } from '../../math/transform-tree/transformTree.ts';
import { SceneNode } from './node.ts';
import { SCENE_MODEL_VERSION, type SceneNodeOptions, type SceneState } from './nodeContracts.ts';
import { sceneNodeFail, sceneNodeVisibility } from './nodeError.ts';

/** Owner of one scene hierarchy and its stable node identifiers. */
export class SceneRoot extends SceneNode {
  readonly version = SCENE_MODEL_VERSION;

  createNode(options: SceneNodeOptions = {}) {
    const slot = this.reserve(options);
    return this.register(new SceneNode(slot.state, slot.id, slot.index, slot.visible));
  }

  /**
   * The storage of a node about to be built: its identifier, its transform slot and the state
   * that owns both. `createNode` builds a plain node on it; a node kind of its own (the scene
   * objects of `world/object3d.ts`) passes it to its constructor, then `register`s itself.
   */
  reserve(options: SceneNodeOptions = {}) {
    this.assertAlive();
    const visible = sceneNodeVisibility(options.visible);
    let id = options.id;
    if (id === undefined)
      do id = `node-${this.state.nextId++}`;
      while (this.state.ids.has(id));
    if (typeof id !== 'string' || !id)
      sceneNodeFail('INVALID_SCENE_NODE_ID', 'A scene node id must be a non-empty string', { id });
    if (this.state.ids.has(id))
      sceneNodeFail('DUPLICATE_SCENE_NODE_ID', `Scene node id ${id} already exists`, { id });
    return { state: this.state, id, index: addTransformNode(this.state.tree), visible };
  }

  /** Makes a node built on `reserve` reachable by its index and its identifier. */
  register<T extends SceneNode>(node: T) {
    this.state.nodes.set(node.index, node);
    this.state.ids.set(node.id, node);
    return node;
  }

  node(id: string) {
    return this.state.ids.get(id);
  }
}

/** Creates an empty, versioned scene hierarchy. */
export function createSceneRoot(options: SceneNodeOptions = {}): SceneRoot {
  const id = options.id ?? 'root';
  if (typeof id !== 'string' || !id)
    sceneNodeFail('INVALID_SCENE_NODE_ID', 'A scene root id must be a non-empty string', { id });
  const visible = sceneNodeVisibility(options.visible);
  const tree = createTransformTree();
  const state: SceneState = { tree, nodes: new Map(), ids: new Map(), nextId: 1 };
  const root = new SceneRoot(state, id, addTransformNode(tree), visible);
  state.root = root;
  state.nodes.set(root.index, root);
  state.ids.set(id, root);
  return root;
}
