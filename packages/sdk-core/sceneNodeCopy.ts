import {
  NODE_AUTO_UPDATE,
  setNodeAutoUpdate,
  setNodeLocalMatrix,
  setNodePosition,
  setNodeQuaternion,
  setNodeScale,
} from './mathTransformTree.ts';
import type { SceneNode } from './sceneNode.ts';
import type { SceneState } from './sceneNodeContracts.ts';
import { sceneNodeFail } from './sceneNodeError.ts';

/** Copies pose and optional descendants without copying the source identifier. */
export function copySceneNodeState(
  state: SceneState,
  target: SceneNode,
  source: SceneNode,
  recursive: boolean,
) {
  if (recursive)
    for (let parent = target.parent; parent; parent = parent.parent)
      if (parent === source)
        sceneNodeFail(
          'SCENE_COPY_OVERLAP',
          'A recursive copy cannot copy an ancestor into its descendant',
          { source: source.id, target: target.id },
        );
  copyValues(state, target, source);
  if (!recursive) return;
  const pending: Array<[SceneNode, SceneNode]> = [];
  for (let i = source.children.length - 1; i >= 0; i--) pending.push([target, source.children[i]]);
  while (pending.length) {
    const [parent, original] = pending.pop()!;
    const clone = target.root.createNode();
    copyValues(state, clone, original);
    parent.add(clone);
    for (let i = original.children.length - 1; i >= 0; i--)
      pending.push([clone, original.children[i]]);
  }
}

function copyValues(state: SceneState, target: SceneNode, source: SceneNode) {
  target.visible = source.visible;
  const position = source.index * 3,
    quaternion = source.index * 4;
  setNodePosition(
    state.tree,
    target.index,
    state.tree.position[position],
    state.tree.position[position + 1],
    state.tree.position[position + 2],
  );
  setNodeQuaternion(
    state.tree,
    target.index,
    state.tree.quaternion[quaternion],
    state.tree.quaternion[quaternion + 1],
    state.tree.quaternion[quaternion + 2],
    state.tree.quaternion[quaternion + 3],
  );
  setNodeScale(
    state.tree,
    target.index,
    state.tree.scale[position],
    state.tree.scale[position + 1],
    state.tree.scale[position + 2],
  );
  setNodeAutoUpdate(
    state.tree,
    target.index,
    !!(state.tree.flags[source.index] & NODE_AUTO_UPDATE),
  );
  setNodeLocalMatrix(state.tree, target.index, source.localMatrix);
}
