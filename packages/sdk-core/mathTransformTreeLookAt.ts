import { writeRotationQuaternion } from './mathMatrix4Trs.ts';
import { setNodeQuaternion, type TransformTree } from './mathTransformTree.ts';
import { updateNodeWorldMatrix } from './mathTransformTreeUpdate.ts';

/**
 * `lookAt` de la référence sur un nœud de la hiérarchie : la rotation locale qui tourne le nœud vers
 * un point monde. Même ordre d'opérations flottantes, cas limites compris : œil sur la cible (l'axe
 * `z` vaut alors `(0, 0, 1)`), direction colinéaire au haut (l'axe `z` est poussé de `0,0001` puis
 * renormalisé), rotation du parent retirée par son quaternion conjugué. Comme la référence, un parent
 * à échelle non uniforme ou cisaillé n'est pas compensé exactement.
 */

const rows = new Float64Array(9),
  own = new Float64Array(4),
  parentRotation = new Float64Array(4);

/**
 * Base `lookAt` de `Matrix4` : `z = eye − target`, `x = up × z`, `y = z × x`, rangée dans `rows`.
 * Tout en scalaires : le haut est lu une fois, et aucun appel ne partage ses retours de type avec
 * d'autres appelants.
 */
function lookAtRows(
  world: Float64Array,
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
  // Une caméra ou une lampe vise de l'œil vers la cible, un objet de la cible vers l'œil.
  const wx = world[at + 12],
    wy = world[at + 13],
    wz = world[at + 14];
  let zx = viewer ? wx - x : x - wx,
    zy = viewer ? wy - y : y - wy,
    zz = viewer ? wz - z : z - wz;
  // Le carré de la norme est gardé : la référence le calcule deux fois de suite (`lengthSq` puis
  // `normalize`), et il ne change que dans la branche dégénérée, qui le recalcule.
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
 * `extractRotation` de la matrice monde rangée en `world[at..at+15]` : chaque colonne multipliée par
 * `1 / sa longueur`. La matrice est lue dans le tampon plat de l'arbre, jamais par la vue du nœud :
 * une lecture de moins, et un seul type de tableau pour toute la fonction.
 */
function extractRotationRows(world: Float64Array, at: number) {
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
  const world = tree.world;
  lookAtRows(world, node * 16, x, y, z, up, viewer);
  writeRotationQuaternion(own, rows);
  const parent = tree.parent[node];
  if (parent >= 0) {
    extractRotationRows(world, parent * 16);
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
