import { multiplyMatrix4 } from './mathMatrix4.ts';
import { composeMatrix4 } from './mathMatrix4Trs.ts';
import {
  NODE_AUTO_UPDATE,
  NODE_LOCAL_CHANGED,
  NODE_TRS_DIRTY,
  NODE_WORLD_NEEDS_UPDATE,
  type TransformTree,
} from './mathTransformTree.ts';
import { ensureOrder, nextStamp, visitSubtree } from './mathTransformTreeStructure.ts';

/**
 * Mise à jour des matrices monde, par lot et sans allocation, avec la sémantique de
 * `updateMatrixWorld(force)` et `updateWorldMatrix(updateParents, updateChildren)` de la référence.
 *
 * La référence recompose et remultiplie tout nœud que sa règle atteint. Ici, un nœud atteint n'est
 * recalculé que si une entrée a changé depuis son dernier calcul : position, rotation ou échelle
 * écrites, matrice locale posée, parent changé, ou matrice monde du parent recalculée depuis (compteur
 * `version` du parent contre `seen` du nœud). Recalculer des entrées inchangées rendrait les mêmes
 * bits : les matrices sont celles de la référence, à chaque instant où elle les calcule. Un nœud que
 * sa règle n'atteint pas garde, comme chez elle, une matrice monde en retard.
 */

const composePosition = new Float64Array(3),
  composeQuaternion = new Float64Array(4),
  composeScale = new Float64Array(3);

/** `updateMatrix` : la matrice locale depuis position, rotation et échelle, si elles ont changé. */
function composeLocal(tree: TransformTree, node: number) {
  const { position, quaternion, scale } = tree;
  const p = node * 3,
    q = node * 4;
  composePosition[0] = position[p];
  composePosition[1] = position[p + 1];
  composePosition[2] = position[p + 2];
  composeQuaternion[0] = quaternion[q];
  composeQuaternion[1] = quaternion[q + 1];
  composeQuaternion[2] = quaternion[q + 2];
  composeQuaternion[3] = quaternion[q + 3];
  composeScale[0] = scale[p];
  composeScale[1] = scale[p + 1];
  composeScale[2] = scale[p + 2];
  composeMatrix4(tree.localViews[node], composePosition, composeQuaternion, composeScale);
  tree.flags[node] = (tree.flags[node] & ~NODE_TRS_DIRTY) | NODE_LOCAL_CHANGED;
}

/** Matrice monde = monde du parent × locale, ou la locale pour une racine, si une entrée a changé. */
function refreshWorld(tree: TransformTree, node: number) {
  const parent = tree.parent[node],
    flags = tree.flags[node];
  if (!(flags & NODE_LOCAL_CHANGED) && (parent < 0 || tree.seen[node] === tree.version[parent]))
    return;
  if (parent < 0) tree.world.set(tree.localViews[node], node * 16);
  else multiplyMatrix4(tree.worldViews[node], tree.worldViews[parent], tree.localViews[node]);
  tree.version[node] = (tree.version[node] + 1) >>> 0;
  tree.seen[node] = parent < 0 ? 0 : tree.version[parent];
  tree.flags[node] = flags & ~NODE_LOCAL_CHANGED;
}

/** Un nœud de `updateMatrixWorld` : `forced` est le `force` que son parent lui transmet. */
function stepMatrixWorld(tree: TransformTree, node: number, forced: boolean) {
  const flags = tree.flags[node];
  if (!forced && !(flags & (NODE_AUTO_UPDATE | NODE_WORLD_NEEDS_UPDATE))) {
    tree.forced[node] = 0;
    return;
  }
  tree.forced[node] = 1;
  if ((flags & (NODE_AUTO_UPDATE | NODE_TRS_DIRTY)) === (NODE_AUTO_UPDATE | NODE_TRS_DIRTY))
    composeLocal(tree, node);
  tree.flags[node] &= ~NODE_WORLD_NEEDS_UPDATE;
  refreshWorld(tree, node);
}

/** Un nœud de `updateWorldMatrix` : la référence recalcule sans condition, et marque sous `updateMatrix`. */
function stepWorldMatrix(tree: TransformTree, node: number) {
  const flags = tree.flags[node];
  if (flags & NODE_AUTO_UPDATE) {
    if (flags & NODE_TRS_DIRTY) composeLocal(tree, node);
    tree.flags[node] |= NODE_WORLD_NEEDS_UPDATE;
  }
  refreshWorld(tree, node);
}

/**
 * `node.updateMatrixWorld(force)` : le nœud et tout son sous-arbre, parents d'abord. Un nœud est
 * atteint s'il se met à jour automatiquement, s'il est marqué, ou si `force` — celui de l'appel pour
 * `node`, sinon « le parent a été atteint ». Les ancêtres de `node` ne sont pas relus.
 */
export function updateNodeMatrixWorld(tree: TransformTree, node: number, force = false) {
  ensureOrder(tree);
  const { order, parent, stamp, forced } = tree;
  const mark = nextStamp(tree);
  stamp[node] = mark;
  stepMatrixWorld(tree, node, force);
  for (let k = tree.orderAt[node] + 1; k < tree.orderCount; k++) {
    const j = order[k],
      p = parent[j];
    if (p < 0 || stamp[p] !== mark) continue;
    stamp[j] = mark;
    stepMatrixWorld(tree, j, forced[p] === 1);
  }
}

/**
 * `node.updateWorldMatrix(updateParents, updateChildren)` : les ancêtres de la racine vers `node` si
 * demandé, le nœud, puis tout son sous-arbre si demandé.
 */
export function updateNodeWorldMatrix(
  tree: TransformTree,
  node: number,
  updateParents: boolean,
  updateChildren: boolean,
) {
  if (updateParents) {
    const { chain, parent } = tree;
    let links = 0;
    for (let walk = parent[node]; walk >= 0; walk = parent[walk]) chain[links++] = walk;
    while (links > 0) stepWorldMatrix(tree, chain[--links]);
  }
  if (updateChildren) visitSubtree(tree, node, stepWorldMatrix);
  else stepWorldMatrix(tree, node);
}
