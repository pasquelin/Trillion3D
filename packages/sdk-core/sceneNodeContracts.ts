import type { TransformTree } from './mathTransformTree.ts';
import type { SceneNode } from './sceneNode.ts';
import type { SceneRoot } from './sceneRoot.ts';

/** Version of the host-owned scene hierarchy contract. */
export const SCENE_MODEL_VERSION = 1;

/** Initial state of a scene node. Identifiers are unique within one root. */
export interface SceneNodeOptions {
  /** Stable identifier within one scene root. Generated when absent. */
  id?: string;
  /** Whether render consumers include this node. Defaults to true. */
  visible?: boolean;
}

export type SceneState = {
  tree: TransformTree;
  nodes: Map<number, SceneNode>;
  ids: Map<string, SceneNode>;
  nextId: number;
  root?: SceneRoot;
};
