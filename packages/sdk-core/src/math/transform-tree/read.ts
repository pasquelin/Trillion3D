import { determinantMatrix4, type NumberSink } from '../matrix/matrix4.ts';
import { decomposeMatrix4 } from '../matrix/matrix4Trs.ts';
import { normalizeVector3 } from '../primitives/vector.ts';
import type { TransformTree } from './transformTree.ts';
import { updateNodeWorldMatrix } from './update.ts';

/**
 * World reads of a node, output passed in. Like the reference `getWorldPosition`, `getWorldQuaternion`,
 * `getWorldScale` and `getWorldDirection`, each first updates the ancestors and
 * the node (`updateWorldMatrix(true, false)`); here, without recomputing anything when nothing has changed.
 */

const decomposedPosition = new Float64Array(3),
  decomposedQuaternion = new Float64Array(4),
  decomposedScale = new Float64Array(3),
  direction = new Float64Array(3);

/** World position: the translation column of the world matrix. */
export function nodeWorldPosition<T extends NumberSink>(out: T, tree: TransformTree, node: number) {
  updateNodeWorldMatrix(tree, node, true, false);
  const world = tree.worldViews[node];
  out[0] = world[12];
  out[1] = world[13];
  out[2] = world[14];
  return out;
}

/** World rotation `(x, y, z, w)`, from the world-matrix decomposition. */
export function nodeWorldQuaternion<T extends NumberSink>(
  out: T,
  tree: TransformTree,
  node: number,
) {
  updateNodeWorldMatrix(tree, node, true, false);
  decomposeMatrix4(tree.worldViews[node], decomposedPosition, out, decomposedScale);
  return out;
}

/** World scale, from the decomposition: a negative determinant is carried by `x` alone. */
export function nodeWorldScale<T extends NumberSink>(out: T, tree: TransformTree, node: number) {
  updateNodeWorldMatrix(tree, node, true, false);
  decomposeMatrix4(tree.worldViews[node], decomposedPosition, decomposedQuaternion, out);
  return out;
}

/**
 * World direction: the third column normalised (a zero column stays zero). `cameraForward`
 * flips it, like the reference camera: a camera looks toward its `−z`.
 */
export function nodeWorldDirection<T extends NumberSink>(
  out: T,
  tree: TransformTree,
  node: number,
  cameraForward: boolean,
) {
  updateNodeWorldMatrix(tree, node, true, false);
  const at = node * 16,
    world = tree.world;
  direction[0] = world[at + 8];
  direction[1] = world[at + 9];
  direction[2] = world[at + 10];
  normalizeVector3(direction);
  // Computed in double before the write: a single-precision output rounds only once.
  const sign = cameraForward ? -1 : 1;
  out[0] = sign * direction[0];
  out[1] = sign * direction[1];
  out[2] = sign * direction[2];
  return out;
}

/**
 * True when the world matrix reverses orientation — negative determinant, one or three mirrored
 * axes: the draw then swaps its front and back faces. Read as-is, without update,
 * like `matrixWorld.determinant()`. A zero or NaN determinant reverses nothing.
 */
export function nodeWorldMirrorsFaces(tree: TransformTree, node: number) {
  return determinantMatrix4(tree.worldViews[node]) < 0;
}
