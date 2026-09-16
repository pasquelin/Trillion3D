import { determinantMatrix4, type NumberSink } from './mathMatrix4.ts';
import { decomposeMatrix4 } from './mathMatrix4Trs.ts';
import { normalizeVector3 } from './mathVector.ts';
import type { TransformTree } from './mathTransformTree.ts';
import { updateNodeWorldMatrix } from './mathTransformTreeUpdate.ts';

/**
 * Lectures monde d'un nœud, sortie passée en paramètre. Comme `getWorldPosition`, `getWorldQuaternion`,
 * `getWorldScale` et `getWorldDirection` de la référence, chacune met d'abord à jour les ancêtres et
 * le nœud (`updateWorldMatrix(true, false)`) ; ici, sans rien recalculer quand rien n'a changé.
 */

const decomposedPosition = new Float64Array(3),
  decomposedQuaternion = new Float64Array(4),
  decomposedScale = new Float64Array(3),
  direction = new Float64Array(3);

/** Position monde : la colonne de translation de la matrice monde. */
export function nodeWorldPosition<T extends NumberSink>(out: T, tree: TransformTree, node: number) {
  updateNodeWorldMatrix(tree, node, true, false);
  const at = node * 16,
    world = tree.world;
  out[0] = world[at + 12];
  out[1] = world[at + 13];
  out[2] = world[at + 14];
  return out;
}

/** Rotation monde `(x, y, z, w)`, par la décomposition de la matrice monde. */
export function nodeWorldQuaternion<T extends NumberSink>(
  out: T,
  tree: TransformTree,
  node: number,
) {
  updateNodeWorldMatrix(tree, node, true, false);
  decomposeMatrix4(tree.worldViews[node], decomposedPosition, out, decomposedScale);
  return out;
}

/** Échelle monde, par la décomposition : un déterminant négatif est porté par `x` seul. */
export function nodeWorldScale<T extends NumberSink>(out: T, tree: TransformTree, node: number) {
  updateNodeWorldMatrix(tree, node, true, false);
  decomposeMatrix4(tree.worldViews[node], decomposedPosition, decomposedQuaternion, out);
  return out;
}

/**
 * Direction monde : la troisième colonne normalisée (une colonne nulle reste nulle). `cameraForward`
 * la retourne, comme la caméra de la référence : une caméra regarde vers son `−z`.
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
  // Calculée en double avant l'écriture : une sortie simple précision n'arrondit qu'une fois.
  const sign = cameraForward ? -1 : 1;
  out[0] = sign * direction[0];
  out[1] = sign * direction[1];
  out[2] = sign * direction[2];
  return out;
}

/**
 * Vrai quand la matrice monde renverse l'orientation — déterminant négatif, un ou trois axes en
 * miroir : le dessin échange alors ses faces avant et arrière. Lue telle quelle, sans mise à jour,
 * comme `matrixWorld.determinant()`. Un déterminant nul ou NaN ne renverse rien.
 */
export function nodeWorldMirrorsFaces(tree: TransformTree, node: number) {
  return determinantMatrix4(tree.worldViews[node]) < 0;
}
