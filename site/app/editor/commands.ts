import type { Object3D, Quaternion, Vector3 } from '../../../packages/sdk-browser/src/index.ts';
import type { Command } from './history.ts';

/** An object's local pose, copied: what a move, a turn or a stretch changes. */
export interface Pose {
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
}

export const poseOf = (object: Object3D): Pose => ({
  position: object.position.clone(),
  quaternion: object.quaternion.clone(),
  scale: object.scale.clone(),
});

export const samePose = (a: Pose, b: Pose) =>
  a.position.equals(b.position) && a.quaternion.equals(b.quaternion) && a.scale.equals(b.scale);

export function applyPose(object: Object3D, pose: Pose) {
  object.position.copy(pose.position);
  object.quaternion.copy(pose.quaternion);
  object.scale.copy(pose.scale);
}

/** A value set from `before` to `after` by `apply`: a field of the inspector, a name, a colour. */
export const valueCommand = <T>(apply: (value: T) => void, before: T, after: T): Command => ({
  undo: () => apply(before),
  redo: () => apply(after),
});

/** A pose changed by a drag of the handles or by the inspector's fields. */
export const poseCommand = (object: Object3D, before: Pose, after: Pose) =>
  valueCommand((pose: Pose) => applyPose(object, pose), before, after);

/** `object` put under `parent`: an object added, or, reversed, removed. */
export const attachCommand = (object: Object3D, parent: Object3D): Command => ({
  undo: () => parent.remove(object),
  redo: () => parent.add(object),
});

export const reversed = (command: Command): Command => ({
  undo: command.redo,
  redo: command.undo,
});

/**
 * `object` moved under `parent`, where it keeps the place it had in the world: its new local pose
 * is its world matrix seen from the new parent. Undone, it goes back under its old parent (last
 * among its siblings) with its old local pose.
 */
export function reparentCommand(object: Object3D, parent: Object3D): Command {
  const from = object.parent!;
  const before = poseOf(object);
  object.updateWorldMatrix(true, false);
  parent.updateWorldMatrix(true, false);
  const local = parent.matrixWorld.clone().invert().multiply(object.matrixWorld);
  const after = poseOf(object);
  local.decompose(after.position, after.quaternion, after.scale);
  return {
    undo: () => {
      from.add(object);
      applyPose(object, before);
    },
    redo: () => {
      parent.add(object);
      applyPose(object, after);
    },
  };
}

/** True when `node` is `ancestor` or lies below it: a node never goes under itself. */
export function isWithin(node: Object3D | null, ancestor: Object3D) {
  for (let at = node; at; at = at.parent) if (at === ancestor) return true;
  return false;
}
