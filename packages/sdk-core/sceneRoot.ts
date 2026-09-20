import { addTransformNode, createTransformTree } from './mathTransformTree.ts';
import { SceneNode } from './sceneNode.ts';
import {
  SCENE_MODEL_VERSION,
  type SceneNodeOptions,
  type SceneState,
} from './sceneNodeContracts.ts';
import { sceneNodeFail, sceneNodeVisibility } from './sceneNodeError.ts';

/** Owner of one scene hierarchy and its stable node identifiers. */
export class SceneRoot extends SceneNode {
  readonly version = SCENE_MODEL_VERSION;

  createNode(options: SceneNodeOptions = {}) {
    this.assertAlive();
    let id = options.id;
    if (id === undefined)
      do id = `node-${this.state.nextId++}`;
      while (this.state.ids.has(id));
    if (typeof id !== 'string' || !id)
      sceneNodeFail('INVALID_SCENE_NODE_ID', 'A scene node id must be a non-empty string', { id });
    if (this.state.ids.has(id))
      sceneNodeFail('DUPLICATE_SCENE_NODE_ID', `Scene node id ${id} already exists`, { id });
    const node = new SceneNode(
      this.state,
      id,
      addTransformNode(this.state.tree),
      sceneNodeVisibility(options.visible),
    );
    this.state.nodes.set(node.index, node);
    this.state.ids.set(id, node);
    return node;
  }

  node(id: string) {
    return this.state.ids.get(id);
  }
}

/** Creates an empty, versioned scene hierarchy. */
export function createSceneRoot(options: SceneNodeOptions = {}): SceneRoot {
  const tree = createTransformTree();
  const state: SceneState = { tree, nodes: new Map(), ids: new Map(), nextId: 1 };
  const id = options.id ?? 'root';
  if (typeof id !== 'string' || !id)
    sceneNodeFail('INVALID_SCENE_NODE_ID', 'A scene root id must be a non-empty string', { id });
  const root = new SceneRoot(
    state,
    id,
    addTransformNode(tree),
    sceneNodeVisibility(options.visible),
  );
  state.root = root;
  state.nodes.set(root.index, root);
  state.ids.set(id, root);
  return root;
}
