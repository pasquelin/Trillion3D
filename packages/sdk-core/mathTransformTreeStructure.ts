import { EngineError } from './cacheContracts.ts';
import {
  NODE_ALIVE,
  NODE_LOCAL_CHANGED,
  assertNode,
  type TransformTree,
} from './mathTransformTree.ts';

/**
 * Structure de la hiérarchie : ordre de mise à jour, retrait, reparentage. L'ordre range chaque parent
 * avant ses enfants ; il est reconstruit paresseusement, une fois, à la première mise à jour qui suit
 * un changement de structure — jamais par image tant que la structure ne bouge pas.
 */

/**
 * Reconstruit l'ordre si la structure a changé. Quand chaque parent a un indice inférieur à ses
 * enfants — le cas d'une scène chargée parent d'abord — l'ordre est celui des indices, contigu en
 * mémoire ; sinon un tri par profondeur, stable en indice.
 */
export function ensureOrder(tree: TransformTree) {
  if (!tree.orderDirty) return;
  const { parent, flags, depth, chain, buckets, order, orderAt, end } = tree;
  depth.fill(-1, 0, end);
  let monotone = true,
    deepest = 0,
    count = 0;
  for (let i = 0; i < end; i++) {
    if (!(flags[i] & NODE_ALIVE)) continue;
    count++;
    if (parent[i] > i) monotone = false;
    let links = 0,
      walk = i;
    while (walk >= 0 && depth[walk] < 0) {
      chain[links++] = walk;
      walk = parent[walk];
    }
    let level = walk < 0 ? -1 : depth[walk];
    while (links > 0) depth[chain[--links]] = ++level;
    if (level > deepest) deepest = level;
  }
  if (monotone) {
    let k = 0;
    for (let i = 0; i < end; i++) if (flags[i] & NODE_ALIVE) order[k++] = i;
  } else {
    buckets.fill(0, 0, deepest + 2);
    for (let i = 0; i < end; i++) if (flags[i] & NODE_ALIVE) buckets[depth[i] + 1]++;
    for (let d = 1; d <= deepest + 1; d++) buckets[d] += buckets[d - 1];
    for (let i = 0; i < end; i++) if (flags[i] & NODE_ALIVE) order[buckets[depth[i]]++] = i;
  }
  for (let k = 0; k < count; k++) orderAt[order[k]] = k;
  tree.orderCount = count;
  tree.orderDirty = false;
}

/** Une marque neuve pour un parcours de sous-arbre ; les marques sont effacées au rebouclage. */
export function nextStamp(tree: TransformTree) {
  tree.call = (tree.call + 1) >>> 0;
  if (tree.call === 0) {
    tree.stamp.fill(0);
    tree.call = 1;
  }
  return tree.call;
}

/**
 * Appelle `visit` sur `node` puis sur chacun de ses descendants, parents d'abord. La mise à jour par
 * image garde sa propre boucle : un appel indirect par nœud y coûterait sur cent mille nœuds.
 */
export function visitSubtree(
  tree: TransformTree,
  node: number,
  visit: (tree: TransformTree, node: number) => void,
) {
  ensureOrder(tree);
  const { order, parent, stamp } = tree;
  const mark = nextStamp(tree);
  stamp[node] = mark;
  visit(tree, node);
  for (let k = tree.orderAt[node] + 1; k < tree.orderCount; k++) {
    const j = order[k],
      p = parent[j];
    if (p < 0 || stamp[p] !== mark) continue;
    stamp[j] = mark;
    visit(tree, j);
  }
}

/**
 * Retire `node` et tous ses descendants ; leurs indices seront réutilisés. Pour détacher un
 * sous-arbre en le gardant, `reparentTransformNode(tree, node, -1)`.
 */
export function removeTransformNode(tree: TransformTree, node: number) {
  assertNode(tree, node);
  visitSubtree(tree, node, freeNode);
  tree.orderDirty = true;
}

function freeNode(tree: TransformTree, node: number) {
  tree.flags[node] = 0;
  tree.free[tree.freeCount++] = node;
}

/**
 * Rattache `node` à `parent` (`-1` : racine), comme `add` de la référence : les matrices ne bougent
 * pas avant la prochaine mise à jour. Lève si `parent` est `node` ou l'un de ses descendants.
 */
export function reparentTransformNode(tree: TransformTree, node: number, parent: number) {
  assertNode(tree, node);
  if (parent !== -1) assertNode(tree, parent);
  for (let walk = parent; walk >= 0; walk = tree.parent[walk])
    if (walk === node)
      throw new EngineError('TRANSFORM_CYCLE', `nœud ${parent} sous ${node} : cycle`, {
        node,
        parent,
      });
  if (tree.parent[node] === parent) return;
  tree.parent[node] = parent;
  tree.flags[node] |= NODE_LOCAL_CHANGED;
  if (!tree.orderDirty && parent >= 0 && tree.orderAt[parent] > tree.orderAt[node])
    tree.orderDirty = true;
}
