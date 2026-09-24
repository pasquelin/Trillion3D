import type { TransformTree } from '../../math/transform-tree/transformTree.ts';
import type { SceneNode } from './node.ts';
import type { SceneRoot } from './root.ts';

/** Version of the host-owned scene hierarchy contract. */
export const SCENE_MODEL_VERSION = 1;

/** Initial state of a scene node. Identifiers are unique within one root. */
export interface SceneNodeOptions {
  /** Stable identifier within one scene root. Generated when absent. */
  id?: string;
  /** Whether render consumers include this node. Defaults to true. */
  visible?: boolean;
}

/** What every node of one scene shares: its transform tree and its indexes. */
export type SceneState = {
  /** The transform tree. */
  tree: TransformTree;
  /** Nodes by name. */
  ids: Map<string, SceneNode>;
  /** The next free name number. */
  nextId: number;
  /** The scene root. */
  root?: SceneRoot;
};
