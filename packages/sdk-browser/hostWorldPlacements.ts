import * as THREE from 'three';
import { hostWorldTree } from './hostWorldTree.ts';
import { copyElements } from './matrixElements.ts';

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

/** L'index des matrices monde de `source`, prêt à être lu : la passe est celle de l'arbre du socle
 *  (`hostWorldTree.ts`), qui accepte aussi bien un nœud qui recompose sa pose qu'un nœud posé. */
export function hostWorldPlacements(source: THREE.Object3D): HostWorldPlacements {
  const tree = hostWorldTree(source);
  // Les nœuds demandés, et eux seuls : une scène dont douze nœuds portent des pages ne recopie que
  // douze matrices par changement de scène. Une seule table, nœud → matrice : le rang d'une liste
  // parallèle serait une troisième façon de dire la même chose, et une de plus à tenir d'accord.
  const matrices = new Map<THREE.Object3D, THREE.Matrix4>();
  return {
    of(node) {
      const held = matrices.get(node);
      if (held) return held;
      const matrix = new THREE.Matrix4();
      copyElements(matrix.elements, tree.world(node));
      matrices.set(node, matrix);
      return matrix;
    },
    refresh() {
      tree.refresh();
      for (const [node, matrix] of matrices) copyElements(matrix.elements, tree.world(node));
    },
  };
}
