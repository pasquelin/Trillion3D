import type * as THREE from 'three';
import {
  EngineError,
  HIERARCHY_ROOT,
  MATRIX_VALUES,
  POSITION_VALUES,
  QUATERNION_VALUES,
  addTransformNode,
  createTransformTree,
  setNodeAutoUpdate,
  setNodeLocalMatrix,
  updateNodeMatrixWorld,
  type TransformTree,
} from '../sdk-core/index.ts';
import { hostLocalInto } from './hostWorldMatrices.ts';
import { createHierarchyLot, type HierarchyLot } from './mathBatchHierarchy.ts';

/**
 * Les matrices monde d'un SOUS-ARBRE de l'hôte, calculées par le moteur depuis les poses locales.
 *
 * L'index couvre le sous-arbre de `source` ET la chaîne d'ancêtres de sa racine, rangés parents
 * avant enfants : chaque nœud compose sa matrice locale, puis la multiplie par la matrice monde de
 * son parent. C'est la règle de `updateMatrixWorld(true)` de la référence, avec les formules du
 * socle dans le même ordre — les mêmes bits.
 *
 * DEUX CHEMINS, UNE SEULE VÉRITÉ. Quand tout le sous-arbre recompose sa pose et qu'un lot de
 * hiérarchie le porte exactement, la passe part EN LOT : les poses sont écrites dans les tampons de
 * l'arène, le gouverneur choisit JavaScript ou WebAssembly, et les matrices monde restent là où le
 * noyau les a écrites — rien n'est recopié, et les vues sont reconstruites quand la mémoire du
 * module a grandi. Sinon — un nœud dont l'hôte a coupé la recomposition porte une matrice posée, que
 * le lot ne sait pas recevoir — la passe se fait sur l'arbre du socle, qui accepte les deux.
 *
 * Le moteur garde SA copie : aucune `matrixWorld` de l'hôte n'est écrite, ni même lue.
 */

export interface HostWorldTree {
  /** Nœuds indexés : le sous-arbre, et les ancêtres de sa racine. */
  readonly n: number;
  /** Vrai quand le dernier recalcul est parti en lot ; faux quand il est passé par l'arbre. */
  readonly batched: boolean;
  /** La matrice monde que le MOTEUR a calculée pour `node`. Lève pour un nœud hors de l'index. */
  world(node: THREE.Object3D): Float64Array;
  /** Recalcule tout l'index depuis les poses locales que l'hôte porte à cet instant. */
  refresh(): void;
}

/** Nœuds du sous-arbre et des ancêtres de sa racine : la taille EXACTE que le lot doit porter. */
function hostWorldNodeCount(source: THREE.Object3D) {
  let n = 0;
  for (let walk = source.parent; walk; walk = walk.parent) n++;
  source.traverse(() => n++);
  return n;
}

/** Le lot de hiérarchie qui porte ce sous-arbre, ou `null` quand il est vide. */
export async function hostWorldLot(source: THREE.Object3D) {
  const n = hostWorldNodeCount(source);
  return n ? await createHierarchyLot(n) : null;
}

/** Les nœuds rangés parents avant enfants, et l'indice du parent de chacun (`-1` pour la racine). */
function collect(source: THREE.Object3D) {
  const nodes: THREE.Object3D[] = [];
  for (let walk = source.parent; walk; walk = walk.parent) nodes.push(walk);
  nodes.reverse();
  // `traverse` de la référence est un parcours préfixe : un parent est toujours vu avant ses enfants.
  source.traverse((object) => nodes.push(object));
  const index = new Map<THREE.Object3D, number>();
  for (let rank = 0; rank < nodes.length; rank++) index.set(nodes[rank], rank);
  const parents = new Int32Array(nodes.length);
  for (let rank = 0; rank < nodes.length; rank++) {
    const parent = nodes[rank].parent;
    parents[rank] = parent ? (index.get(parent) ?? -1) : -1;
  }
  return { nodes, index, parents };
}

/** L'arbre du socle qui reçoit les poses : chaque nœud porte la matrice locale que le moteur a lue. */
function socle(nodes: readonly THREE.Object3D[], parents: Int32Array) {
  const tree = createTransformTree(Math.max(1, nodes.length));
  for (let rank = 0; rank < nodes.length; rank++)
    setNodeAutoUpdate(tree, addTransformNode(tree, parents[rank]), false);
  return tree;
}

const scratch = new Float64Array(MATRIX_VALUES);

/** Les poses locales lues, posées dans l'arbre, puis tout le sous-arbre remonté en une passe. */
function parArbre(nodes: readonly THREE.Object3D[], tree: TransformTree) {
  for (let rank = 0; rank < nodes.length; rank++)
    setNodeLocalMatrix(tree, rank, hostLocalInto(scratch, nodes[rank]));
  updateNodeMatrixWorld(tree, 0, true);
}

/** Les poses locales écrites dans les tampons de l'arène, puis le lot joué par le gouverneur. */
function parLot(nodes: readonly THREE.Object3D[], parents: Int32Array, lot: HierarchyLot) {
  const positions = lot.positions,
    rotations = lot.rotations,
    scales = lot.scales,
    liens = lot.parents;
  for (let rank = 0; rank < nodes.length; rank++) {
    const { position: p, quaternion: q, scale: s } = nodes[rank];
    const at = rank * POSITION_VALUES,
      turn = rank * QUATERNION_VALUES;
    positions[at] = p.x;
    positions[at + 1] = p.y;
    positions[at + 2] = p.z;
    rotations[turn] = q.x;
    rotations[turn + 1] = q.y;
    rotations[turn + 2] = q.z;
    rotations[turn + 3] = q.w;
    scales[at] = s.x;
    scales[at + 1] = s.y;
    scales[at + 2] = s.z;
    liens[rank] = parents[rank] < 0 ? HIERARCHY_ROOT : parents[rank];
  }
  lot.run();
}

/** Vrai quand chaque nœud recompose sa matrice locale : la seule forme que le lot sait recevoir. */
function composent(nodes: readonly THREE.Object3D[]) {
  for (const node of nodes) if (!node.matrixAutoUpdate) return false;
  return true;
}

/**
 * L'index des matrices monde de `source`, recalculé une première fois avant d'être rendu. `lot` est
 * le tampon de hiérarchie réservé pour ce sous-arbre ; sans lui, la passe est celle de l'arbre.
 */
export function hostWorldTree(source: THREE.Object3D, lot?: HierarchyLot | null): HostWorldTree {
  const { nodes, index, parents } = collect(source);
  const enLot = lot?.holds(nodes.length) ? lot : null;
  let tree: TransformTree | null = null,
    batched = false,
    porteur: ArrayBufferLike | null = null,
    views: Float64Array[] = [];
  /** Les vues par nœud du tampon du lot, reconstruites quand la mémoire du module a grandi. */
  const vuesDuLot = (monde: Float64Array) => {
    if (monde.buffer !== porteur) {
      porteur = monde.buffer;
      views = Array.from({ length: nodes.length }, (_, rank) =>
        monde.subarray(rank * MATRIX_VALUES, (rank + 1) * MATRIX_VALUES),
      );
    }
    return views;
  };
  const arbre = () => (tree ??= socle(nodes, parents));
  const self: HostWorldTree = {
    n: nodes.length,
    get batched() {
      return batched;
    },
    world(node) {
      const rank = index.get(node);
      if (rank === undefined)
        throw new EngineError('UNKNOWN_TRANSFORM_NODE', `${node.name}: nœud hors de l’index`, {
          nodeName: node.name,
        });
      return batched && enLot ? vuesDuLot(enLot.world)[rank] : arbre().worldViews[rank];
    },
    refresh() {
      if (!nodes.length) return;
      batched = enLot !== null && composent(nodes);
      if (batched && enLot) parLot(nodes, parents, enLot);
      else parArbre(nodes, arbre());
    },
  };
  self.refresh();
  return self;
}
