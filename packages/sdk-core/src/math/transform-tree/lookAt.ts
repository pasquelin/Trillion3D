import { writeRotationQuaternion } from '../matrix/matrix4Trs.ts';
import { setNodeQuaternion, type TransformTree } from './transformTree.ts';
import { updateNodeWorldMatrix } from './update.ts';

/**
 * Reference `lookAt` on a hierarchy node: the local rotation that turns the node toward
 * a world point. Same floating-point operation order, edge cases included: eye on the target (the
 * `z` axis is then `(0, 0, 1)`), direction collinear with up (the `z` axis is pushed by `0.0001` then
 * renormalised), parent rotation removed by its conjugate quaternion. Like the reference, a parent
 * with non-uniform or sheared scale is not compensated exactly.
 */

const rows = new Float64Array(9),
  own = new Float64Array(4),
  parentRotation = new Float64Array(4);

/**
 * `Matrix4` `lookAt` basis: `z = eye − target`, `x = up × z`, `y = z × x`, stored in `rows`.
 * All in scalars: up is read once, and no call shares its typed returns with
 * other callers.
 */
function lookAtRows(
  world: ArrayLike<number>,
  at: number,
  x: number,
  y: number,
  z: number,
  up: ArrayLike<number>,
  viewer: boolean,
) {
  const ux = up[0],
    uy = up[1],
    uz = up[2];
  // A camera or a light aims from the eye toward the target, an object from the target toward the eye.
  const wx = world[at + 12],
    wy = world[at + 13],
    wz = world[at + 14];
  let zx = viewer ? wx - x : x - wx,
    zy = viewer ? wy - y : y - wy,
    zz = viewer ? wz - z : z - wz;
  // The squared length is kept: the reference computes it twice in a row (`lengthSq` then
  // `normalize`), and it only changes in the degenerate branch, which recomputes it.
  let carre = zx * zx + zy * zy + zz * zz;
  if (carre === 0) {
    zz = 1;
    carre = zx * zx + zy * zy + zz * zz;
  }
  let inverse = 1 / (Math.sqrt(carre) || 1);
  zx *= inverse;
  zy *= inverse;
  zz *= inverse;
  let xx = uy * zz - uz * zy,
    xy = uz * zx - ux * zz,
    xz = ux * zy - uy * zx;
  carre = xx * xx + xy * xy + xz * xz;
  if (carre === 0) {
    if (Math.abs(uz) === 1) zx += 0.0001;
    else zz += 0.0001;
    inverse = 1 / (Math.sqrt(zx * zx + zy * zy + zz * zz) || 1);
    zx *= inverse;
    zy *= inverse;
    zz *= inverse;
    xx = uy * zz - uz * zy;
    xy = uz * zx - ux * zz;
    xz = ux * zy - uy * zx;
    carre = xx * xx + xy * xy + xz * xz;
  }
  inverse = 1 / (Math.sqrt(carre) || 1);
  xx *= inverse;
  xy *= inverse;
  xz *= inverse;
  rows[0] = xx;
  rows[1] = zy * xz - zz * xy;
  rows[2] = zx;
  rows[3] = xy;
  rows[4] = zz * xx - zx * xz;
  rows[5] = zy;
  rows[6] = xz;
  rows[7] = zx * xy - zy * xx;
  rows[8] = zz;
}

/**
 * `extractRotation` of the world matrix stored in `world[at..at+15]`: each column multiplied by
 * `1 / its length`. The matrix is read from the tree's flat buffer, never through the node view:
 * one less read, and a single array type for the whole function.
 */
function extractRotationRows(world: ArrayLike<number>, at: number) {
  for (let column = 0; column < 3; column++) {
    const c = at + column * 4;
    const x = world[c],
      y = world[c + 1],
      z = world[c + 2];
    const inverse = 1 / Math.sqrt(x * x + y * y + z * z);
    rows[column] = x * inverse;
    rows[3 + column] = y * inverse;
    rows[6 + column] = z * inverse;
  }
}

/**
 * Turns `node` toward the world point `(x, y, z)`. `viewer` is true for a camera or a light, which
 * look toward their `−z`, false for an object, which presents its `+z`. `up` is the node's up,
 * `(0, 1, 0)` by default in the reference. First updates the ancestors and the node.
 */
/**
 * The local rotation that turns a node whose world matrix is `world[at…]` toward the world point
 * `(x, y, z)`, written into `out` as `(x, y, z, w)`: the reference's `lookAt`, parent included
 * when `parentWorld` is given. `viewer` and `up` are those of `lookAtNode`; the world matrices
 * must already be resolved.
 */
function lookAtQuaternion(
  out: Float64Array,
  world: ArrayLike<number>,
  at: number,
  x: number,
  y: number,
  z: number,
  up: ArrayLike<number>,
  viewer: boolean,
  parentWorld: ArrayLike<number> | null,
  parentAt = 0,
) {
  lookAtRows(world, at, x, y, z, up, viewer);
  writeRotationQuaternion(out, rows);
  if (parentWorld) {
    extractRotationRows(parentWorld, parentAt);
    writeRotationQuaternion(parentRotation, rows);
    // Parent conjugate, then `conjugate × own` product of `premultiply`.
    const ax = -parentRotation[0],
      ay = -parentRotation[1],
      az = -parentRotation[2],
      aw = parentRotation[3];
    const bx = out[0],
      by = out[1],
      bz = out[2],
      bw = out[3];
    out[0] = ax * bw + aw * bx + ay * bz - az * by;
    out[1] = ay * bw + aw * by + az * bx - ax * bz;
    out[2] = az * bw + aw * bz + ax * by - ay * bx;
    out[3] = aw * bw - ax * bx - ay * by - az * bz;
  }
  return out;
}

/**
 * Turns `node` toward the world point `(x, y, z)`. `viewer` is true for a camera or a light, which
 * look toward their `−z`, false for an object, which presents its `+z`. `up` is the node's up,
 * `(0, 1, 0)` by default in the reference. First updates the ancestors and the node.
 */
export function lookAtNode(
  tree: TransformTree,
  node: number,
  x: number,
  y: number,
  z: number,
  up: ArrayLike<number>,
  viewer: boolean,
) {
  updateNodeWorldMatrix(tree, node, true, false);
  const world = tree.world;
  const parent = tree.parent[node];
  lookAtQuaternion(
    own,
    world,
    node * 16,
    x,
    y,
    z,
    up,
    viewer,
    parent >= 0 ? world : null,
    parent * 16,
  );
  setNodeQuaternion(tree, node, own[0], own[1], own[2], own[3]);
}
