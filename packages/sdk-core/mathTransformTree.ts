import { EngineError } from './cacheContracts.ts';

/**
 * Hiérarchie de transformations du moteur, orientée données : un nœud est un indice dans des
 * tableaux plats — parent, drapeaux, position, quaternion `(x, y, z, w)`, échelle, matrice locale et
 * matrice monde colonne-major. `localViews[i]` et `worldViews[i]` sont des vues de seize nombres sur
 * `local` et `world`, créées à l'agrandissement et jamais pendant une mise à jour : le GPU lit le
 * tampon entier, les formules du socle lisent la vue d'un nœud. Les écritures passent par les setters,
 * qui marquent ce qu'elles changent. Un agrandissement remplace tous les tableaux : un appelant relit
 * `tree.world` ou `tree.worldViews` après un ajout.
 */
export interface TransformTree {
  capacity: number;
  /** Indices servis : tout nœud vivant est sous cette borne. */
  end: number;
  parent: Int32Array;
  flags: Uint8Array;
  position: Float64Array;
  quaternion: Float64Array;
  scale: Float64Array;
  local: Float64Array;
  world: Float64Array;
  localViews: Float64Array[];
  worldViews: Float64Array[];
  /** Nombre de recalculs de la matrice monde, et celui du parent lu au dernier recalcul. */
  version: Uint32Array;
  seen: Uint32Array;
  /** Indices libérés, réutilisés avant d'étendre `end`. */
  free: Int32Array;
  freeCount: number;
  /** Ordre de mise à jour, parents avant enfants, et rang de chaque nœud dans cet ordre. */
  order: Int32Array;
  orderAt: Int32Array;
  orderCount: number;
  orderDirty: boolean;
  /** Tampons de travail des parcours : profondeur, chaîne d'ancêtres, seaux, marques. */
  depth: Int32Array;
  chain: Int32Array;
  buckets: Int32Array;
  stamp: Uint32Array;
  call: number;
}

/** `matrixAutoUpdate` : la matrice locale est recomposée depuis la position, la rotation, l'échelle. */
export const NODE_AUTO_UPDATE = 1;
/** Pose ou matrice locale écrite depuis la dernière composition. */
export const NODE_TRS_DIRTY = 2;
/** Matrice locale ou parent changé depuis le dernier calcul de la matrice monde. */
export const NODE_LOCAL_CHANGED = 4;
/** `matrixWorldNeedsUpdate` de la référence, que seule sa règle de mise à jour lit. */
export const NODE_WORLD_NEEDS_UPDATE = 8;
export const NODE_ALIVE = 16;

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function views(buffer: Float64Array, capacity: number) {
  return Array.from({ length: capacity }, (_, i) => buffer.subarray(i * 16, i * 16 + 16));
}

function grown<T extends Int32Array | Uint8Array | Uint32Array | Float64Array>(
  old: T | undefined,
  make: new (length: number) => T,
  length: number,
) {
  const next = new make(length);
  if (old) next.set(old);
  return next;
}

/** Porte la capacité à `capacity` nœuds, contenu conservé. */
function reserve(tree: TransformTree, capacity: number) {
  tree.capacity = capacity;
  tree.parent = grown(tree.parent, Int32Array, capacity);
  tree.flags = grown(tree.flags, Uint8Array, capacity);
  tree.position = grown(tree.position, Float64Array, capacity * 3);
  tree.quaternion = grown(tree.quaternion, Float64Array, capacity * 4);
  tree.scale = grown(tree.scale, Float64Array, capacity * 3);
  tree.local = grown(tree.local, Float64Array, capacity * 16);
  tree.world = grown(tree.world, Float64Array, capacity * 16);
  tree.localViews = views(tree.local, capacity);
  tree.worldViews = views(tree.world, capacity);
  tree.version = grown(tree.version, Uint32Array, capacity);
  tree.seen = grown(tree.seen, Uint32Array, capacity);
  tree.free = grown(tree.free, Int32Array, capacity);
  tree.order = grown(tree.order, Int32Array, capacity);
  tree.orderAt = grown(tree.orderAt, Int32Array, capacity);
  tree.depth = new Int32Array(capacity);
  tree.chain = new Int32Array(capacity);
  tree.buckets = new Int32Array(capacity + 1);
  tree.stamp = grown(tree.stamp, Uint32Array, capacity);
}

/** Une hiérarchie vide, prête pour `capacity` nœuds sans agrandissement. */
export function createTransformTree(capacity = 64): TransformTree {
  const tree = { end: 0, freeCount: 0, orderCount: 0, orderDirty: false, call: 0 } as TransformTree;
  reserve(tree, Math.max(1, capacity));
  return tree;
}

/** Lève si `node` n'est pas un nœud vivant de l'arbre. */
export function assertNode(tree: TransformTree, node: number) {
  if (!(node >= 0 && node < tree.end && tree.flags[node] & NODE_ALIVE))
    throw new EngineError('UNKNOWN_TRANSFORM_NODE', `nœud ${node} absent de la hiérarchie`, {
      node,
    });
}

/**
 * Ajoute un nœud sous `parent` (`-1` pour une racine) et rend son indice. État d'un objet neuf de la
 * référence : position nulle, rotation identité, échelle 1, matrices identité, mise à jour
 * automatique.
 */
export function addTransformNode(tree: TransformTree, parent = -1) {
  if (parent !== -1) assertNode(tree, parent);
  let node: number;
  if (tree.freeCount) node = tree.free[--tree.freeCount];
  else {
    if (tree.end === tree.capacity) reserve(tree, tree.capacity * 2);
    node = tree.end++;
  }
  tree.parent[node] = parent;
  tree.flags[node] = NODE_ALIVE | NODE_AUTO_UPDATE | NODE_TRS_DIRTY | NODE_LOCAL_CHANGED;
  setNodePosition(tree, node, 0, 0, 0);
  setNodeQuaternion(tree, node, 0, 0, 0, 1);
  setNodeScale(tree, node, 1, 1, 1);
  tree.localViews[node].set(IDENTITY);
  tree.worldViews[node].set(IDENTITY);
  tree.version[node] = 0;
  tree.seen[node] = 0;
  // Un ordre à jour contient déjà le parent : le nouveau venu se range après lui, en fin d'ordre. Un
  // ordre périmé sera reconstruit en entier.
  if (!tree.orderDirty) {
    tree.orderAt[node] = tree.orderCount;
    tree.order[tree.orderCount++] = node;
  }
  return node;
}

export function setNodePosition(
  tree: TransformTree,
  node: number,
  x: number,
  y: number,
  z: number,
) {
  const p = tree.position,
    at = node * 3;
  p[at] = x;
  p[at + 1] = y;
  p[at + 2] = z;
  tree.flags[node] |= NODE_TRS_DIRTY;
}

export function setNodeQuaternion(
  tree: TransformTree,
  node: number,
  x: number,
  y: number,
  z: number,
  w: number,
) {
  const q = tree.quaternion,
    at = node * 4;
  q[at] = x;
  q[at + 1] = y;
  q[at + 2] = z;
  q[at + 3] = w;
  tree.flags[node] |= NODE_TRS_DIRTY;
}

export function setNodeScale(tree: TransformTree, node: number, x: number, y: number, z: number) {
  const s = tree.scale,
    at = node * 3;
  s[at] = x;
  s[at + 1] = y;
  s[at + 2] = z;
  tree.flags[node] |= NODE_TRS_DIRTY;
}

/**
 * Pose la matrice locale. Sous mise à jour automatique, la prochaine mise à jour la recompose depuis
 * position, rotation et échelle, comme la référence écrase `matrix`.
 */
export function setNodeLocalMatrix(tree: TransformTree, node: number, m: ArrayLike<number>) {
  const local = tree.localViews[node];
  for (let i = 0; i < 16; i++) local[i] = m[i];
  tree.flags[node] |= NODE_LOCAL_CHANGED | NODE_TRS_DIRTY;
}

/**
 * `matrixAutoUpdate`. Rien d'autre à marquer en la réactivant : une matrice locale qui diffère de sa
 * composition porte déjà `NODE_TRS_DIRTY`, posé par `setNodeLocalMatrix` ou par un setter de pose.
 */
export function setNodeAutoUpdate(tree: TransformTree, node: number, auto: boolean) {
  if (auto) tree.flags[node] |= NODE_AUTO_UPDATE;
  else tree.flags[node] &= ~NODE_AUTO_UPDATE;
}
