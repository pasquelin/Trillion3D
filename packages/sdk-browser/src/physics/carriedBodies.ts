import type { CommandWriter } from '../../../sdk-core/src/physics/index.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { worldPoseOf } from './bodyFrame.ts';

/** A kinematic body a dynamic body's subtree holds: the node it follows, and the world pose,
 *  position then turn, it was last driven to. */
export type Carried = { node: Object3D; last: Float64Array };

/** `node`, followed from `position` and `quaternion`, where its body is made. */
export const carriedFrom = (
  node: Object3D,
  position: ArrayLike<number>,
  quaternion: ArrayLike<number>,
): Carried => ({ node, last: Float64Array.of(...Array.from(position), ...Array.from(quaternion)) });

/**
 * The body in slot `slot`, `carried`, driven where its node is drawn now — its dynamic ancestor
 * moved it —, pushing what it meets; a node that stands still sends nothing, so a resting body
 * wakes nobody.
 */
export function driveCarried(
  writer: Pick<CommandWriter, 'moveKinematic'>,
  { node, last }: Carried,
  slot: number,
) {
  const { position, quaternion } = worldPoseOf(node);
  let same = true;
  for (let i = 0; i < 7 && same; i++) same = last[i] === (i < 3 ? position[i] : quaternion[i - 3]);
  if (same) return;
  last.set(position);
  last.set(quaternion, 3);
  writer.moveKinematic(slot, position, quaternion);
}
