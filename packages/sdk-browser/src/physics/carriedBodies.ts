import { BODY_INDEX, type CommandWriter } from '../../../sdk-core/src/physics/index.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { worldPoseOf } from './bodyFrame.ts';

/** A kinematic body a dynamic body's subtree holds: the node it follows, and the world pose,
 *  position then turn, it was last driven to. */
export type Carried = { node: Object3D; last: Float64Array };

/** `node`, followed from `position` and `quaternion`, where its body is made. */
export function carriedFrom(
  node: Object3D,
  position: ArrayLike<number>,
  quaternion: ArrayLike<number>,
): Carried {
  const last = new Float64Array(7);
  last.set(position);
  last.set(quaternion, 3);
  return { node, last };
}

/**
 * The body `id`, when it is `carried`, driven where its node is drawn now — its dynamic ancestor
 * moved it —, pushing what it meets; a node that stands still sends nothing, so a resting body
 * wakes nobody. Whether it is carried: one that is not is its caller's to move.
 */
export function driveCarried(
  writer: Pick<CommandWriter, 'moveKinematic'>,
  { id, carried }: { id: number; carried?: Carried },
) {
  if (!carried) return false;
  const { position, quaternion } = worldPoseOf(carried.node);
  const { last } = carried;
  let same = true;
  for (let i = 0; i < 3; i++) same &&= last[i] === position[i];
  for (let i = 0; i < 4; i++) same &&= last[3 + i] === quaternion[i];
  if (same) return true;
  last.set(position);
  last.set(quaternion, 3);
  writer.moveKinematic(id & BODY_INDEX, position, quaternion);
  return true;
}
