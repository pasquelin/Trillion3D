import { Quaternion } from '../../../sdk-core/src/world/math/quaternion.ts';
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';

const position = new Vector3(),
  turn = new Quaternion();

/** A node's world position and quaternion, in scratch every caller shares: read them at once. */
export function worldPoseOf(node: Object3D) {
  node.updateWorldMatrix(true, false);
  node.getWorldPosition(position);
  node.getWorldQuaternion(turn);
  return { position: position.elements, quaternion: turn.elements };
}

/** A node's scale in the world, axis by axis up the transform chain. */
export function worldScaleOf(node: Object3D) {
  const size = { x: 1, y: 1, z: 1 };
  for (let at: Object3D | null = node; at; at = at.parent) {
    size.x *= at.scale.x;
    size.y *= at.scale.y;
    size.z *= at.scale.z;
  }
  return size;
}
