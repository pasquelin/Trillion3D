import * as THREE from 'three';
import { hostWorldTree } from './hostWorldTree.ts';
import { copyElements } from './matrixElements.ts';
import type { HierarchyLot } from './mathBatchHierarchy.ts';

/**
 * Les matrices monde que LE MOTEUR possède pour les nœuds dessinés de la scène de l'hôte.
 *
 * `hostWorldTree.ts` calcule ces matrices depuis les poses locales ; ce fichier-ci leur donne le
 * contenant que les fiches de page et les racines de cluster portent encore — une matrice de la
 * bibliothèque hôte, parce que c'est ce que l'hôte attache à son graphe et ce que les moteurs
 * témoins dessinent. Le contenant est le seul emprunt : ses seize nombres viennent tous du socle, et
 * la `matrixWorld` du maillage source n'est ni lue ni écrite.
 *
 * Une matrice est rendue UNE FOIS par nœud et vit aussi longtemps que la scène : ce que `refresh`
 * réécrit, tout ce qui la porte le voit à l'instant même — une fiche de page, une racine, une copie
 * transparente. C'était le défaut que la photo de `matrixWorld` avait déjà coûté une fois : ici
 * aucune photo n'est prise, donc aucune n'est à reprendre.
 */
export interface HostWorldPlacements {
  /** La matrice monde du moteur pour `node` : le même objet d'un appel à l'autre. Lève pour un nœud
   *  hors du sous-arbre indexé. */
  of(node: THREE.Object3D): THREE.Matrix4;
  /** Recalcule l'index depuis les poses locales de l'hôte, puis réécrit les matrices rendues. */
  refresh(): void;
}

/**
 * L'index des matrices monde de `source`, prêt à être lu. `lot` est le tampon de hiérarchie réservé
 * pour ce sous-arbre ; sans lui, la passe est celle de l'arbre du socle (`hostWorldTree.ts`).
 */
export function hostWorldPlacements(
  source: THREE.Object3D,
  lot?: HierarchyLot | null,
): HostWorldPlacements {
  const tree = hostWorldTree(source, lot);
  // Les nœuds demandés, et eux seuls : une scène de quatre-vingt mille nœuds dont douze portent des
  // pages ne recopie que douze matrices par changement de scène.
  const placed = new Map<THREE.Object3D, THREE.Matrix4>();
  return {
    of(node) {
      let matrix = placed.get(node);
      if (!matrix) {
        matrix = new THREE.Matrix4();
        placed.set(node, matrix);
        copyElements(matrix.elements, tree.world(node));
      }
      return matrix;
    },
    refresh() {
      tree.refresh();
      for (const [node, matrix] of placed) copyElements(matrix.elements, tree.world(node));
    },
  };
}
