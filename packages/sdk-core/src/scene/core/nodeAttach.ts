import { multiplyMatrix4 } from '../../math/matrix/matrix4.ts';
import { invertMatrix4 } from '../../math/matrix/matrix4Inverse.ts';
import { decomposeMatrix4 } from '../../math/matrix/matrix4Trs.ts';
import type { SceneNode } from './node.ts';

/** Scratch of `attachSceneNode`, which allocates nothing; a bundle that never attaches drops it. */
const local = /* @__PURE__ */ new Float64Array(16),
  position = /* @__PURE__ */ new Float64Array(3),
  quaternion = /* @__PURE__ */ new Float64Array(4),
  scale = /* @__PURE__ */ new Float64Array(3);

/**
 * `parent.attach(child)`, as the reference computes it: the child's new local matrix is the inverse
 * of `parent`'s world matrix times its own, both resolved first, so its world matrix is kept. Its
 * position, rotation and scale are read out of that matrix: a sheared one loses its shear there,
 * and a parent scaled to zero inverts to the zero matrix, both as with the reference. The matrix
 * itself is written too, sixteen numbers: under manual update it is the pose. When `parent`'s
 * `add` declines the child, as a subclass's may, the child's pose is left as it was.
 */
export function attachSceneNode<T extends SceneNode>(parent: T, child: SceneNode): T {
  invertMatrix4(local, parent.updateWorldMatrix(true, false).worldMatrix);
  multiplyMatrix4(local, local, child.updateWorldMatrix(true, false).worldMatrix as Float64Array);
  parent.add(child);
  if (child.parent !== parent) return parent;
  decomposeMatrix4(local, position, quaternion, scale);
  child.setPosition(position[0], position[1], position[2]);
  child.setQuaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
  child.setScale(scale[0], scale[1], scale[2]).setLocalMatrix(local).updateWorldMatrix(false, true);
  return parent;
}
