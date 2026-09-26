import { multiplyMatrix4 } from '../matrix/matrix4.ts';
import { invertMatrix4 } from '../matrix/matrix4Inverse.ts';
import { decomposeMatrix4 } from '../matrix/matrix4Trs.ts';
import {
  setNodeLocalMatrix,
  setNodePosition,
  setNodeQuaternion,
  setNodeScale,
  type TransformTree,
} from './transformTree.ts';
import { updateNodeWorldMatrix } from './update.ts';

/** Scratch values of the two functions below: neither allocates. */
const inverse = new Float64Array(16),
  local = new Float64Array(16),
  position = new Float64Array(3),
  quaternion = new Float64Array(4),
  scale = new Float64Array(3);

/**
 * The local matrix that keeps `node` where it stands in the world once it is under `parent`, as
 * the reference `attach` computes it: the inverse of `parent`'s world matrix times `node`'s, both
 * resolved first. A parent scaled to zero inverts to the zero matrix, as with the reference. The
 * result is a scratch the next call overwrites.
 */
export function nodeLocalUnder(tree: TransformTree, node: number, parent: number) {
  updateNodeWorldMatrix(tree, node, true, false);
  updateNodeWorldMatrix(tree, parent, true, false);
  invertMatrix4(inverse, tree.worldViews[parent]);
  multiplyMatrix4(local, inverse, tree.worldViews[node]);
  return local;
}

/**
 * Writes `m` as `node`'s local pose: its local matrix, and the position, rotation and scale read
 * out of it, which an automatic update recomposes. A sheared `m` loses its shear there, as with
 * the reference.
 */
export function setNodeLocalPose(tree: TransformTree, node: number, m: ArrayLike<number>) {
  decomposeMatrix4(m, position, quaternion, scale);
  setNodePosition(tree, node, position[0], position[1], position[2]);
  setNodeQuaternion(tree, node, quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
  setNodeScale(tree, node, scale[0], scale[1], scale[2]);
  setNodeLocalMatrix(tree, node, m);
}
