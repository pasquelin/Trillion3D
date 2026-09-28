import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts';
import { Quaternion } from '../../../sdk-core/src/world/math/quaternion.ts';
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { resolveCameraWorld } from '../camera/world.ts';

const world = new Matrix4(),
  parent = new Matrix4(),
  at = new Vector3(),
  turn = new Quaternion(),
  size = new Vector3();

/**
 * Poses `node` at the world pose `position[p]`, `quaternion[q]`, of world scale `scale[p]`: the
 * pose made local to its parent, which a node nested under others — a compiled model's, under
 * its ancestors and its model — is posed by. Its place and turn are written, as any page's move
 * (the world hears it); its scale, the one its body was made at, stays.
 */
export function placeNode(
  node: Object3D,
  position: ArrayLike<number>,
  p: number,
  quaternion: ArrayLike<number>,
  q: number,
  scale: ArrayLike<number>,
) {
  at.set(position[p], position[p + 1], position[p + 2]);
  turn.set(quaternion[q], quaternion[q + 1], quaternion[q + 2], quaternion[q + 3]);
  world.compose(at, turn, size.set(scale[p], scale[p + 1], scale[p + 2]));
  if (node.parent) {
    parent.fromArray(resolveCameraWorld(node.parent).matrixWorld.elements);
    world.premultiply(parent.invert());
  }
  world.decompose(at, turn, size);
  node.position.set(at.x, at.y, at.z);
  node.quaternion.set(turn.x, turn.y, turn.z, turn.w);
}
