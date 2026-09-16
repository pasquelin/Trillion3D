import type * as THREE from 'three';
import { MATRIX_VALUES, multiplyMatrix4 } from '../sdk-core/index.ts';
import { hostLocalInto } from './hostWorldMatrices.ts';

/**
 * La matrice monde d'UN nœud de l'hôte, calculée par le moteur depuis les poses locales de sa chaîne
 * d'ancêtres.
 *
 * C'est la règle de `updateWorldMatrix(true, false)` de la référence, terme à terme : la racine pose
 * sa matrice locale, puis chaque descendant multiplie celle de son parent par la sienne. Les deux
 * formules sont celles du socle — composition de la pose (`hostLocalInto`) et produit
 * (`multiplyMatrix4`) —, dans le même ordre : les mêmes bits, échelles négatives, `-0` et
 * cisaillements compris.
 *
 * Rien n'est demandé à la bibliothèque de l'hôte et rien ne lui est écrit : sa `matrixWorld` reste
 * ce qu'elle était. Le moteur garde sa copie dans le tampon que l'appelant lui tend.
 *
 * Aucune allocation par appel : la chaîne remontée vit dans un tableau repris d'un appel à l'autre,
 * agrandi seulement par un graphe plus profond que tous ceux vus avant lui.
 */

const local = new Float64Array(MATRIX_VALUES);
let chain: (THREE.Object3D | undefined)[] = new Array(64);

/** La matrice monde de `node` écrite dans `out`, qui est rendu. `out` peut être n'importe quel tampon. */
export function hostWorldChainInto(out: Float64Array, node: THREE.Object3D) {
  let depth = 0;
  for (let walk: THREE.Object3D | null = node; walk; walk = walk.parent) {
    if (depth === chain.length) chain = chain.concat(new Array<undefined>(chain.length));
    chain[depth++] = walk;
  }
  // `chain[depth - 1]` est la racine : sa matrice monde est sa matrice locale, comme chez la
  // référence. Le produit est calculé SUR PLACE — `multiplyMatrix4` lit ses trente-deux entrées
  // avant d'écrire la moindre sortie, donc `out` peut être à la fois le monde du parent et celui de
  // l'enfant.
  hostLocalInto(out, chain[depth - 1] as THREE.Object3D);
  for (let rank = depth - 2; rank >= 0; rank--) {
    hostLocalInto(local, chain[rank] as THREE.Object3D);
    multiplyMatrix4(out, out, local);
  }
  // La chaîne est relâchée : garder des nœuds de l'hôte ici retiendrait sa scène après un déchargement.
  for (let rank = 0; rank < depth; rank++) chain[rank] = undefined;
  return out;
}
