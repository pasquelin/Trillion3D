import { writeRotationQuaternion } from './mathMatrix4Trs.ts';
import { crossVector3 } from './mathVector.ts';
import { setNodeQuaternion, type TransformTree } from './mathTransformTree.ts';
import { normalize } from './mathTransformTreeRead.ts';
import { updateNodeWorldMatrix } from './mathTransformTreeUpdate.ts';

/**
 * `lookAt` de la référence sur un nœud de la hiérarchie : la rotation locale qui tourne le nœud vers
 * un point monde. Même ordre d'opérations flottantes, cas limites compris : œil sur la cible (l'axe
 * `z` vaut alors `(0, 0, 1)`), direction colinéaire au haut (l'axe `z` est poussé de `0,0001` puis
 * renormalisé), rotation du parent retirée par son quaternion conjugué. Comme la référence, un parent
 * à échelle non uniforme ou cisaillé n'est pas compensé exactement.
 */

const axisX = new Float64Array(3),
  axisY = new Float64Array(3),
  axisZ = new Float64Array(3),
  rows = new Float64Array(9),
  own = new Float64Array(4),
  parentRotation = new Float64Array(4);

const lengthSquared = (v: Float64Array) => v[0] * v[0] + v[1] * v[1] + v[2] * v[2];

/** Base `lookAt` de `Matrix4` : `z = eye − target`, `x = up × z`, `y = z × x`, rangée dans `rows`. */
function lookAtRows(eye: ArrayLike<number>, target: ArrayLike<number>, up: ArrayLike<number>) {
  axisZ[0] = eye[0] - target[0];
  axisZ[1] = eye[1] - target[1];
  axisZ[2] = eye[2] - target[2];
  if (lengthSquared(axisZ) === 0) axisZ[2] = 1;
  normalize(axisZ);
  crossVector3(axisX, up, axisZ);
  if (lengthSquared(axisX) === 0) {
    if (Math.abs(up[2]) === 1) axisZ[0] += 0.0001;
    else axisZ[2] += 0.0001;
    normalize(axisZ);
    crossVector3(axisX, up, axisZ);
  }
  normalize(axisX);
  crossVector3(axisY, axisZ, axisX);
  for (let row = 0; row < 3; row++) {
    rows[row * 3] = axisX[row];
    rows[row * 3 + 1] = axisY[row];
    rows[row * 3 + 2] = axisZ[row];
  }
}

/** `extractRotation` de la matrice monde `m` : chaque colonne multipliée par `1 / sa longueur`. */
function extractRotationRows(m: ArrayLike<number>) {
  for (let column = 0; column < 3; column++) {
    const c = column * 4;
    const inverse = 1 / Math.sqrt(m[c] * m[c] + m[c + 1] * m[c + 1] + m[c + 2] * m[c + 2]);
    rows[column] = m[c] * inverse;
    rows[3 + column] = m[c + 1] * inverse;
    rows[6 + column] = m[c + 2] * inverse;
  }
}

const eye = new Float64Array(3),
  target = new Float64Array(3);

/**
 * Tourne `node` vers le point monde `(x, y, z)`. `viewer` vaut vrai pour une caméra ou une lampe, qui
 * regardent vers leur `−z`, faux pour un objet, qui présente son `+z`. `up` est le haut du nœud,
 * `(0, 1, 0)` par défaut dans la référence. Met d'abord à jour les ancêtres et le nœud.
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
  const world = tree.worldViews[node];
  eye[0] = world[12];
  eye[1] = world[13];
  eye[2] = world[14];
  target[0] = x;
  target[1] = y;
  target[2] = z;
  if (viewer) lookAtRows(eye, target, up);
  else lookAtRows(target, eye, up);
  writeRotationQuaternion(own, rows);
  const parent = tree.parent[node];
  if (parent >= 0) {
    extractRotationRows(tree.worldViews[parent]);
    writeRotationQuaternion(parentRotation, rows);
    // Conjugué du parent, puis produit `conjugué × propre` de `premultiply`.
    const ax = -parentRotation[0],
      ay = -parentRotation[1],
      az = -parentRotation[2],
      aw = parentRotation[3];
    const bx = own[0],
      by = own[1],
      bz = own[2],
      bw = own[3];
    own[0] = ax * bw + aw * bx + ay * bz - az * by;
    own[1] = ay * bw + aw * by + az * bx - ax * bz;
    own[2] = az * bw + aw * bz + ax * by - ay * bx;
    own[3] = aw * bw - ax * bx - ay * by - az * bz;
  }
  setNodeQuaternion(tree, node, own[0], own[1], own[2], own[3]);
}
