import { copyMatrix4, multiplyMatrix4 } from './mathMatrix4.ts';
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

/** `updateMatrix` : la matrice locale depuis la position, la rotation et l'échelle du nœud. */
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
}

/**
 * Un nœud atteint : matrice locale recomposée si la mise à jour est automatique et la pose écrite,
 * puis matrice monde = monde du parent × locale (la locale recopiée pour une racine) si une entrée a
 * changé. Les drapeaux sont lus une fois et écrits une fois, `worldNeedsUpdate` compris : effacé par
 * `updateMatrixWorld`, posé par `updateWorldMatrix` sous mise à jour automatique.
 */
function refreshNode(tree: TransformTree, node: number, fromWorldMatrix: boolean) {
  const flags = tree.flags[node],
    auto = (flags & NODE_AUTO_UPDATE) !== 0,
    compose = auto && (flags & NODE_TRS_DIRTY) !== 0;
  if (compose) composeLocal(tree, node);
  let next = compose ? flags & ~NODE_TRS_DIRTY : flags;
  if (fromWorldMatrix) {
    if (auto) next |= NODE_WORLD_NEEDS_UPDATE;
  } else next &= ~NODE_WORLD_NEEDS_UPDATE;
  const parent = tree.parent[node],
    version = tree.version,
    changed = compose || (flags & NODE_LOCAL_CHANGED) !== 0;
  if (parent < 0) {
    if (changed) {
      const at = node * 16;
      copyMatrix4(tree.world, tree.local, at, at);
      tree.seen[node] = 0;
      version[node] = (version[node] + 1) >>> 0;
    }
  } else {
    const parentVersion = version[parent];
    if (changed || tree.seen[node] !== parentVersion) {
      multiplyMatrix4(tree.worldViews[node], tree.worldViews[parent], tree.localViews[node]);
      tree.seen[node] = parentVersion;
      version[node] = (version[node] + 1) >>> 0;
    }
  }
  tree.flags[node] = next & ~NODE_LOCAL_CHANGED;
}

const stepWorldMatrix = (tree: TransformTree, node: number) => refreshNode(tree, node, true);

/**
 * `node.updateMatrixWorld(force)` : le nœud et tout son sous-arbre, parents d'abord. Un nœud est
 * atteint s'il se met à jour automatiquement, s'il est marqué, ou si `force` — celui de l'appel pour
 * `node`, sinon « le parent a été atteint ». Les ancêtres de `node` ne sont pas relus. La marque d'un
 * nœud parcouru vaut `2 · parcours + atteint` : une seule lecture dit à l'enfant s'il est dans le
 * sous-arbre et ce que son parent lui transmet.
 */
export function updateNodeMatrixWorld(tree: TransformTree, node: number, force = false) {
  ensureOrder(tree);
  const { order, parent, stamp, flags } = tree;
  const visited = nextStamp(tree) * 2,
    reach = NODE_AUTO_UPDATE | NODE_WORLD_NEEDS_UPDATE;
  const reached = force || (flags[node] & reach) !== 0;
  if (reached) refreshNode(tree, node, false);
  stamp[node] = reached ? visited | 1 : visited;
  for (let k = tree.orderAt[node] + 1, end = tree.orderCount; k < end; k++) {
    const j = order[k],
      p = parent[j];
    if (p < 0) continue;
    const mark = stamp[p];
    if ((mark | 1) !== (visited | 1)) continue;
    if (mark !== visited || (flags[j] & reach) !== 0) {
      refreshNode(tree, j, false);
      stamp[j] = visited | 1;
    } else stamp[j] = visited;
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
    while (links > 0) refreshNode(tree, chain[--links], true);
  }
  if (updateChildren) visitSubtree(tree, node, stepWorldMatrix);
  else refreshNode(tree, node, true);
}
